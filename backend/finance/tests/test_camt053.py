"""camt.053 XML statements: the parser and their import."""

import json
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import (
    TestCase,
)

from ..models import (
    CSVImport,
    CSVMapping,
    Transaction,
)
from ..statement_parsers import parse_camt053
from .base import FinanceTestCase, json_body


CAMT053_ENTRY_TEMPLATE = """
            <Ntry>
                <NtryRef>{ref}</NtryRef>
                <Amt Ccy="CZK">{amount}</Amt>
                <CdtDbtInd>{indicator}</CdtDbtInd>
                <RvslInd>false</RvslInd>
                <Sts>{status}</Sts>
                <BookgDt><Dt>{booked}</Dt></BookgDt>
                <ValDt><Dt>{value}</Dt></ValDt>
                <BkTxCd><Prtry><Cd>{code}</Cd><Issr>CBA</Issr></Prtry></BkTxCd>
                <NtryDtls>
                    <TxDtls>
                        <Refs><AcctSvcrRef>{ref}</AcctSvcrRef></Refs>
                        <AmtDtls>{instructed}</AmtDtls>
                        <RltdPties>{parties}</RltdPties>
                        {remittance}
                    </TxDtls>
                </NtryDtls>
            </Ntry>"""


def camt053_entry(
    ref,
    amount,
    indicator,
    parties,
    remittance="",
    instructed=None,
    status="BOOK",
    booked="2026-09-02",
    value="2026-09-01",
    code="90000501000",
):
    instructed = instructed or f'<InstdAmt><Amt Ccy="CZK">{amount}</Amt></InstdAmt>'
    return CAMT053_ENTRY_TEMPLATE.format(
        ref=ref,
        amount=amount,
        indicator=indicator,
        status=status,
        booked=booked,
        value=value,
        code=code,
        instructed=instructed,
        parties=parties,
        remittance=remittance,
    )


CAMT053_ENTRIES = [
    camt053_entry(
        "C1",
        "249.00",
        "DBIT",
        "<Cdtr><Nm>Internal clearing CZK</Nm></Cdtr>"
        "<CdtrAcct><Id><Othr><Id>null-null/null</Id></Othr></Id></CdtrAcct>"
        "<Prtry><Pty><Nm>COFFEE SHOP, Brno, CZ</Nm></Pty></Prtry>",
        code="30000201000",
    ),
    camt053_entry(
        "T1",
        "1000.00",
        "DBIT",
        "<Cdtr><Nm>Landlord</Nm></Cdtr>"
        "<CdtrAcct><Id><IBAN>CZ6508000000192000145399</IBAN></Id></CdtrAcct>",
        "<RmtInf><Ustrd>Rent September</Ustrd>"
        "<Strd><CdtrRefInf><Ref>VS:2026</Ref></CdtrRefInf></Strd>"
        "<Strd><CdtrRefInf><Ref>KS:308</Ref></CdtrRefInf></Strd></RmtInf>",
    ),
    camt053_entry(
        "S1",
        "5000.00",
        "CRDT",
        "<Dbtr><Nm>Employer s.r.o.</Nm></Dbtr>"
        "<DbtrAcct><Id><Othr><Id>null-2302719247/2010</Id></Othr></Id></DbtrAcct>",
        "<RmtInf><Ustrd>Salary</Ustrd>"
        "<Strd><CdtrRefInf><Ref>SS:77</Ref></CdtrRefInf></Strd></RmtInf>",
    ),
    camt053_entry(
        "F1",
        "256.14",
        "DBIT",
        "<Cdtr><Nm>Internal clearing CZK</Nm></Cdtr>"
        "<CdtrAcct><Id><Othr><Id>null-null/null</Id></Othr></Id></CdtrAcct>"
        "<Prtry><Pty><Nm>HOSTING INC, SAN FRANCISCO, US</Nm></Pty></Prtry>",
        instructed='<InstdAmt><Amt Ccy="USD">12</Amt>'
        "<CcyXchg><SrcCcy>USD</SrcCcy><TrgtCcy>CZK</TrgtCcy>"
        "<XchgRate>21.345</XchgRate></CcyXchg></InstdAmt>",
        code="30000201000",
    ),
]


CAMT053_DETAIL_AMOUNTS = {
    "TxAmt": '<AmtDtls><TxAmt><Amt Ccy="CZK">{}</Amt></TxAmt></AmtDtls>',
    "InstdAmt": '<AmtDtls><InstdAmt><Amt Ccy="CZK">{}</Amt></InstdAmt></AmtDtls>',
    "Amt": '<Amt Ccy="CZK">{}</Amt><CdtDbtInd>DBIT</CdtDbtInd>',  # camt.053.001.04+
}


def camt053_batch_entry(ref, amount, details, amount_tag="TxAmt"):
    """One booking that bundles several payments: (reference, amount, payee, message)."""
    detail_xml = ""
    for detail_ref, detail_amount, payee, message in details:
        refs = (
            f"<Refs><AcctSvcrRef>{detail_ref}</AcctSvcrRef></Refs>"
            if detail_ref
            else ""
        )
        amount_xml = (
            CAMT053_DETAIL_AMOUNTS[amount_tag].format(detail_amount)
            if detail_amount
            else ""
        )
        detail_xml += (
            f"<TxDtls>{refs}{amount_xml}"
            f"<RltdPties><Cdtr><Nm>{payee}</Nm></Cdtr></RltdPties>"
            f"<RmtInf><Ustrd>{message}</Ustrd></RmtInf></TxDtls>"
        )
    entry_ref = f"<NtryRef>{ref}</NtryRef>" if ref else ""
    return f"""
            <Ntry>
                {entry_ref}
                <Amt Ccy="CZK">{amount}</Amt>
                <CdtDbtInd>DBIT</CdtDbtInd>
                <Sts>BOOK</Sts>
                <BookgDt><Dt>2026-09-10</Dt></BookgDt>
                <ValDt><Dt>2026-09-10</Dt></ValDt>
                <BkTxCd><Prtry><Cd>10000108000</Cd><Issr>CBA</Issr></Prtry></BkTxCd>
                <NtryDtls><Btch><NbOfTxs>{len(details)}</NbOfTxs></Btch>{detail_xml}</NtryDtls>
            </Ntry>"""


def camt053_document(
    entries=None,
    opening="10000.00",
    closing="13494.86",
    iban="CZ0001000000000000000123",
    declared=None,
):
    entries = CAMT053_ENTRIES if entries is None else entries
    declared = len(entries) if declared is None else declared
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
    <BkToCstmrStmt>
        <GrpHdr><MsgId>test</MsgId><CreDtTm>2026-10-01T10:00:00+02:00</CreDtTm></GrpHdr>
        <Stmt>
            <Id>STMT-1</Id>
            <FrToDt>
                <FrDtTm>2026-09-01T00:00:00+02:00</FrDtTm>
                <ToDtTm>2026-09-30T23:59:59+02:00</ToDtTm>
            </FrToDt>
            <Acct><Id><IBAN>{iban}</IBAN></Id><Ccy>CZK</Ccy></Acct>
            <Bal>
                <Tp><CdOrPrtry><Cd>PRCD</Cd></CdOrPrtry></Tp>
                <Amt Ccy="CZK">{opening}</Amt><CdtDbtInd>CRDT</CdtDbtInd>
                <Dt><Dt>2026-08-31</Dt></Dt>
            </Bal>
            <Bal>
                <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
                <Amt Ccy="CZK">{closing}</Amt><CdtDbtInd>CRDT</CdtDbtInd>
                <Dt><Dt>2026-09-30</Dt></Dt>
            </Bal>
            <TxsSummry><TtlNtries><NbOfNtries>{declared}</NbOfNtries></TtlNtries></TxsSummry>
            {"".join(entries)}
        </Stmt>
    </BkToCstmrStmt>
</Document>
""".encode("utf-8")


class Camt053ParserTests(TestCase):
    def rows_by_id(self, result):
        return {row["original_id"]: row for _line, row in result.rows}

    def test_parses_entries_into_logical_fields(self):
        result = parse_camt053(camt053_document())
        rows = self.rows_by_id(result)

        self.assertEqual(len(rows), 4)
        self.assertEqual(result.warnings(), [])
        self.assertEqual(result.statements[0].account_number, "123/0100")

        card = rows["C1"]
        self.assertEqual(card["amount"], "-249.00")
        self.assertEqual(card["transaction_date"], "2026-09-02")
        self.assertEqual(card["posted_date"], "2026-09-01")
        self.assertEqual(card["counterparty_name"], "COFFEE SHOP, Brno, CZ")
        self.assertEqual(card["counterparty_account_number"], "")
        self.assertEqual(card["description"], "COFFEE SHOP, Brno, CZ")
        self.assertEqual(card["transaction_type"], "30000201000")

        rent = rows["T1"]
        self.assertEqual(rent["counterparty_account_number"], "19-2000145399/0800")
        self.assertEqual(rent["description"], "Rent September Landlord")
        self.assertEqual(rent["variable_symbol"], "2026")
        self.assertEqual(rent["constant_symbol"], "308")

        salary = rows["S1"]
        self.assertEqual(salary["amount"], "5000.00")
        self.assertEqual(salary["counterparty_name"], "Employer s.r.o.")
        self.assertEqual(salary["counterparty_account_number"], "2302719247/2010")
        self.assertEqual(salary["specific_symbol"], "77")

        foreign = rows["F1"]
        self.assertEqual(foreign["currency"], "CZK")
        self.assertEqual(foreign["instructed_amount"], "12")
        self.assertEqual(foreign["instructed_currency"], "USD")
        self.assertEqual(foreign["exchange_rate"], "21.345")
        self.assertNotIn("instructed_currency", card)

    def test_a_batch_entry_becomes_one_row_per_payment(self):
        split = camt053_batch_entry(
            "B1",
            "300.00",
            [
                ("B1-1", "100.00", "Water company", "Water"),
                ("B1-2", "200.00", "Power", "Power"),
            ],
        )
        no_refs = camt053_batch_entry(
            "B4",
            "30.00",
            [("", "10.00", "Shop A", "A"), ("", "20.00", "Shop B", "B")],
            amount_tag="InstdAmt",
        )
        result = parse_camt053(
            camt053_document([split, no_refs], opening="1000.00", closing="670.00")
        )
        rows = self.rows_by_id(result)

        self.assertEqual(result.warnings(), [])
        self.assertEqual(sorted(rows), ["B1-1", "B1-2", "B4/1", "B4/2"])
        self.assertEqual(rows["B1-1"]["amount"], "-100.00")
        self.assertEqual(rows["B1-1"]["counterparty_name"], "Water company")
        self.assertEqual(rows["B1-1"]["description"], "Water Water company")
        self.assertEqual(rows["B1-2"]["amount"], "-200.00")
        self.assertEqual(rows["B4/2"]["counterparty_name"], "Shop B")
        # What older versions imported the entry as, for the import's duplicate check.
        self.assertEqual(rows["B1-2"]["batch_original_id"], "B1-1")
        self.assertEqual(rows["B4/2"]["batch_original_id"], "B4")
        self.assertEqual(rows["B4/2"]["batch_amount"], "-30.00")
        self.assertEqual(result.statements[0].entry_count, 2)

    def test_a_batch_without_amounts_per_payment_stays_one_row(self):
        no_amounts = camt053_batch_entry(
            "B2", "50.00", [("B2-1", "", "Shop A", "A"), ("B2-2", "", "Shop B", "B")]
        )
        not_adding_up = camt053_batch_entry(
            "B3",
            "25.00",
            [("B3-1", "10.00", "Shop C", "C"), ("B3-2", "10.00", "Shop D", "D")],
        )
        without_id = camt053_batch_entry(
            "", "5.00", [("", "2.00", "Shop E", "E"), ("", "3.00", "Shop F", "F")]
        )
        result = parse_camt053(
            camt053_document(
                [no_amounts, not_adding_up, without_id],
                opening="100.00",
                closing="20.00",
            )
        )
        rows = self.rows_by_id(result)

        self.assertEqual(sorted(rows), ["", "B2-1", "B3-1"])
        self.assertEqual(rows["B2-1"]["amount"], "-50.00")
        self.assertEqual(rows["B2-1"]["counterparty_name"], "Shop A")
        self.assertEqual(rows["B3-1"]["amount"], "-25.00")
        self.assertEqual(rows[""]["amount"], "-5.00")
        self.assertNotIn("batch_original_id", rows["B2-1"])
        self.assertEqual(result.statements[0].unsplit_batches, 3)
        self.assertIn("bundle several payments", result.warnings()[0])

    def test_skips_pending_entries_and_reports_them(self):
        pending = camt053_entry(
            "P1", "10.00", "DBIT", "<Cdtr><Nm>Shop</Nm></Cdtr>", status="PDNG"
        )
        result = parse_camt053(camt053_document(CAMT053_ENTRIES + [pending]))

        self.assertNotIn("P1", self.rows_by_id(result))
        self.assertEqual(result.statements[0].skipped_unbooked, 1)
        self.assertEqual(len(result.warnings()), 1)
        self.assertIn("not booked", result.warnings()[0])

    def test_warns_when_balances_or_entry_count_do_not_reconcile(self):
        result = parse_camt053(camt053_document(closing="1.00", declared=7))
        warnings = " ".join(result.warnings())

        self.assertIn("does not equal closing balance", warnings)
        self.assertIn("declares 7 entries", warnings)

    def test_rejects_invalid_documents(self):
        with self.assertRaisesMessage(ValueError, "DOCTYPE"):
            parse_camt053(
                b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><Document/>'
            )
        with self.assertRaisesMessage(ValueError, "not a camt.053"):
            parse_camt053(b"<Document><Other/></Document>")
        with self.assertRaisesMessage(ValueError, "Could not read XML"):
            parse_camt053(b"<Document>")
        # A declaration after a long comment, or in UTF-16, is refused as well.
        long_comment = b"<!--" + b"x" * 5000 + b"-->"
        with self.assertRaisesMessage(ValueError, "DOCTYPE"):
            parse_camt053(
                b'<?xml version="1.0"?>'
                + long_comment
                + b'<!DOCTYPE x [<!ENTITY a "b">]><Document/>'
            )
        with self.assertRaisesMessage(ValueError, "DOCTYPE"):
            parse_camt053(
                '<?xml version="1.0" encoding="UTF-16"?>'
                '<!DOCTYPE x [<!ENTITY a "b">]><Document/>'.encode("utf-16")
            )
        with self.assertRaisesMessage(ValueError, "empty"):
            parse_camt053(b"  ")


class Camt053ImportAPITests(FinanceTestCase):
    def setUp(self):
        super().setUp()
        response = self.client.post(
            "/api/csv-mappings/",
            data=json.dumps({"name": "Statement XML", "file_format": "camt053"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.camt_mapping = CSVMapping.objects.get(id=json_body(response)["id"])

    def xml_file(self, body=None):
        return SimpleUploadedFile(
            "statement.xml",
            body or camt053_document(),
            content_type="application/xml",
        )

    def import_data(self, **overrides):
        data = {
            "bank_account_id": str(self.account.id),
            "csv_mapping_id": str(self.camt_mapping.id),
            "csv_file": self.xml_file(),
        }
        data.update(overrides)
        return data

    def test_creating_statement_mapping_uses_fixed_column_map(self):
        self.assertEqual(self.camt_mapping.file_format, "camt053")
        self.assertEqual(self.camt_mapping.column_map["amount"], "amount")
        self.assertEqual(self.camt_mapping.decimal_separator, ".")

        response = self.client.patch(
            f"/api/csv-mappings/{self.camt_mapping.id}/",
            data=json.dumps({"file_format": "pdf"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_preview_reports_statement_checks(self):
        response = self.client.post("/api/imports/preview/", self.import_data())
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["loaded"], 4)
        self.assertEqual(payload["summary"]["valid"], 4)
        self.assertEqual(payload["statement"]["warnings"], [])
        self.assertEqual(
            payload["statement"]["statements"][0]["closing_balance"], "13494.86"
        )

        self.account.account_number = "999/0100"
        self.account.save()
        mismatch = json_body(
            self.client.post("/api/imports/preview/", self.import_data())
        )
        self.assertIn("does not match", mismatch["statement"]["warnings"][0])

    def test_import_categorizes_and_skips_duplicates_on_reimport(self):
        self.keyword("Coffee", ["coffee shop"])

        with patch("finance.views.sync_missing_exchange_rates") as sync_rates:
            sync_rates.return_value = {}
            first = self.client.post("/api/imports/", self.import_data())
            second = self.client.post("/api/imports/", self.import_data())

        self.assertEqual(first.status_code, 201)
        self.assertEqual(json_body(first)["report"]["created"]["count"], 4)
        self.assertEqual(Transaction.objects.count(), 4)
        self.assertEqual(json_body(second)["report"]["created"]["count"], 0)
        self.assertEqual(len(json_body(second)["report"]["skipped"]["duplicates"]), 4)

        card = Transaction.objects.get(original_id="C1")
        self.assertEqual(card.amount, Decimal("-249.00"))
        self.assertEqual(card.posted_date, date(2026, 9, 1))
        self.assertEqual(card.subcategory, self.subcategory)
        self.assertEqual(card.raw_data["transaction_type"], "30000201000")
        foreign = Transaction.objects.get(original_id="F1")
        self.assertEqual(foreign.raw_data["instructed_currency"], "USD")

    def batch_statement(self):
        batch = camt053_batch_entry(
            "B1",
            "300.00",
            [
                ("", "100.00", "Water company", "Water"),
                ("", "200.00", "Power", "Power"),
            ],
            amount_tag="Amt",
        )
        return camt053_document([batch], opening="1000.00", closing="700.00")

    def import_statement(self, document):
        with patch("finance.views.sync_missing_exchange_rates") as sync_rates:
            sync_rates.return_value = {}
            return self.client.post(
                "/api/imports/", self.import_data(csv_file=self.xml_file(document))
            )

    def test_each_payment_of_a_batch_entry_is_imported(self):
        response = self.import_statement(self.batch_statement())
        again = self.import_statement(self.batch_statement())

        self.assertEqual(response.status_code, 201)
        self.assertEqual(json_body(response)["report"]["created"]["count"], 2)
        self.assertEqual(
            sorted(Transaction.objects.values_list("original_id", "amount")),
            [("B1/1", Decimal("-100.00")), ("B1/2", Decimal("-200.00"))],
        )
        self.assertEqual(len(json_body(again)["report"]["skipped"]["duplicates"]), 2)

    def test_a_batch_an_older_version_imported_whole_is_not_imported_again(self):
        # Versions up to 0.8.0 imported the entry as one row with the total.
        Transaction.objects.create(
            bank_account=self.account,
            original_id="B1",
            transaction_date="2026-09-10",
            description="Water Water company",
            amount=Decimal("-300.00"),
        )
        preview = json_body(
            self.client.post(
                "/api/imports/preview/",
                self.import_data(csv_file=self.xml_file(self.batch_statement())),
            )
        )
        response = self.import_statement(self.batch_statement())

        self.assertEqual(preview["summary"]["duplicates"], 2)
        self.assertEqual(json_body(response)["report"]["created"]["count"], 0)
        self.assertEqual(len(json_body(response)["report"]["skipped"]["duplicates"]), 2)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_an_unreadable_statement_fails_with_a_readable_message(self):
        response = self.client.post(
            "/api/imports/",
            self.import_data(
                csv_file=self.xml_file(
                    b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><Document/>'
                )
            ),
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 400)
        self.assertTrue(payload["error"].startswith("Could not read the file: "))
        self.assertIn("DOCTYPE", payload["error"])
        self.assertFalse(CSVImport.objects.exists())
