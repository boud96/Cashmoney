// The dashboard's Overview tab: the monthly flow chart, and income and expenses by
// category as ranked bars with the Want / Need / Investment split.
import { lazy, Suspense, useMemo, useState } from "react";

import { ChevronIcon } from "../../icons.jsx";
import {
  autoOpenCategories,
  baseLayout,
  completeMonthlyRows,
  cssVar,
  formatMoneyValue,
  formatMoneyWithCurrency,
  monthlyTickStep,
  rankCategories,
  titleCase,
  wniColor,
  wniSplit,
} from "../../shared.js";

// Plotly loads as its own chunk (see PlotlyChart.jsx); ChartPanel shows a placeholder meanwhile.
const Plot = lazy(() => import("../../PlotlyChart.jsx"));

// Which categories the user opened or closed, per side, by name. Kept while the app
// runs (the dashboard unmounts on other pages), not stored.
const openedCategories = { expense: new Map(), income: new Map() };

export function OverviewCharts({ currency, hideAmounts, summary }) {
  const ready = Boolean(summary);
  return (
    <div className="overview-charts">
      <ChartPanel className="chart-panel-wide" ready={ready} title="Monthly flow">
        <MonthlyChart hideAmounts={hideAmounts} rows={summary?.monthly || []} />
      </ChartPanel>
      <div className="overview-rankings">
        <CategoryRanking currency={currency} hideAmounts={hideAmounts} ready={ready} side="expense" title="Expenses by category" tree={summary?.expense_categories}>
          <WniSplitBar hideAmounts={hideAmounts} rows={summary?.want_need_investment || []} />
        </CategoryRanking>
        <CategoryRanking currency={currency} hideAmounts={hideAmounts} ready={ready} side="income" title="Income by category" tree={summary?.income_categories} />
      </div>
    </div>
  );
}

function ChartPanel({ children, className = "", ready = true, title }) {
  const loading = <div className="chart-empty">Loading chart…</div>;
  return (
    <section className={`panel chart-panel ${className}`}>
      <div className="panel-header"><h2>{title}</h2></div>
      {ready ? <Suspense fallback={loading}>{children}</Suspense> : loading}
    </section>
  );
}

// Income up and expenses down from the same spot for each month, net as a line. The
// x-axis is a date axis, so long ranges label every 3rd, 6th or 12th month and never
// rotate the labels.
function MonthlyChart({ hideAmounts, rows }) {
  const monthlyRows = completeMonthlyRows(rows);
  if (!monthlyRows.length) return <EmptyChart />;
  const months = monthlyRows.map((row) => `${row.month}-01`);
  const amounts = monthlyRows.map((row) => [
    formatMoneyValue(row.income, hideAmounts),
    formatMoneyValue(row.expense, hideAmounts),
    formatMoneyValue(row.net, hideAmounts),
  ]);
  const shared = { customdata: amounts, x: months, xhoverformat: "%B %Y", xperiod: "M1", xperiodalignment: "middle" };
  // From the first month's start to the last month's end, without Plotly's padding.
  const [lastYear, lastMonth] = monthlyRows[monthlyRows.length - 1].month.split("-").map(Number);
  const rangeEnd = `${lastMonth === 12 ? lastYear + 1 : lastYear}-${String((lastMonth % 12) + 1).padStart(2, "0")}-01`;
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[
        {
          ...shared,
          hovertemplate: "Income: %{customdata[0]}<extra></extra>",
          marker: { color: cssVar("--green", "#2f8f65") },
          name: "Income",
          type: "bar",
          y: monthlyRows.map((row) => row.income),
        },
        {
          ...shared,
          hovertemplate: "Expenses: %{customdata[1]}<extra></extra>",
          marker: { color: cssVar("--red", "#dc2626") },
          name: "Expenses",
          type: "bar",
          y: monthlyRows.map((row) => -row.expense),
        },
        {
          ...shared,
          hovertemplate: "Net: %{customdata[2]}<extra></extra>",
          line: { color: cssVar("--text", "#e6edf3"), width: 2 },
          marker: { color: cssVar("--text", "#e6edf3"), size: 5 },
          mode: "lines+markers",
          name: "Net",
          type: "scatter",
          y: monthlyRows.map((row) => row.net),
        },
      ]}
      layout={baseLayout({
        bargap: 0.3,
        barmode: "relative",
        hovermode: "x unified",
        legend: { orientation: "h", x: 0, xanchor: "left", y: 1.12 },
        margin: { t: 30, r: 16, b: 40, l: 54 },
        xaxis: {
          dtick: monthlyTickStep(monthlyRows.length),
          range: [months[0], rangeEnd],
          tickangle: 0,
          ticklabelmode: "period",
          type: "date",
        },
        yaxis: {
          showticklabels: !hideAmounts,
          zeroline: true,
          zerolinecolor: cssVar("--border", "#9facb5"),
          zerolinewidth: 1,
        },
      })}
      useResizeHandler
    />
  );
}

function formatShare(share) {
  if (share > 0 && share < 0.005) {
    return "<1%";
  }
  return `${Math.round(share * 100)}%`;
}

// One side of the breakdown: categories largest first, each a button that opens its
// subcategories. A category over half of its side starts open.
function CategoryRanking({ children, currency, hideAmounts, ready, side, title, tree }) {
  const { rows, total } = useMemo(() => rankCategories(tree || []), [tree]);
  const autoOpen = useMemo(() => new Set(autoOpenCategories(rows)), [rows]);
  const [, setVersion] = useState(0);
  const remembered = openedCategories[side];
  const isOpen = (name) => (remembered.has(name) ? remembered.get(name) : autoOpen.has(name));

  function toggle(name) {
    remembered.set(name, !isOpen(name));
    setVersion((version) => version + 1);
  }

  const largest = rows[0]?.amount || 1;
  return (
    <section className="panel chart-panel category-ranking" data-side={side}>
      <div className="panel-header">
        <h2>{title}</h2>
        {ready && rows.length ? <span className="category-ranking-total">{formatMoneyWithCurrency(total, currency, hideAmounts)}</span> : null}
      </div>
      {!ready ? <div className="chart-empty">Loading chart…</div> : !rows.length ? <EmptyChart /> : (
        <ul className="category-ranking-list">
          {rows.map((row) => {
            const open = isOpen(row.name);
            return (
              <li key={row.name}>
                <button aria-expanded={open} className="category-ranking-row" onClick={() => toggle(row.name)} type="button">
                  <RankingCells amount={row.amount} color={row.color} hideAmounts={hideAmounts} name={row.name} scale={largest} share={row.share}>
                    <ChevronIcon open={open} size={14} />
                  </RankingCells>
                </button>
                {open && row.children.length ? (
                  <ul className="category-ranking-children">
                    {row.children.map((child) => (
                      <li className="category-ranking-row is-child" key={child.name}>
                        <RankingCells amount={child.amount} color={child.color} hideAmounts={hideAmounts} name={child.name} scale={row.amount} share={child.share} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {ready ? children : null}
    </section>
  );
}

function RankingCells({ amount, children, color, hideAmounts, name, scale, share }) {
  const fill = color || cssVar("--muted", "#8b949e");
  return (
    <>
      <span className="ranking-caret">{children}</span>
      <span className="ranking-label">
        <span aria-hidden="true" className="cell-dot" style={{ background: fill }} />
        <span className="ranking-name">{name}</span>
      </span>
      <span aria-hidden="true" className="ranking-bar"><span style={{ background: fill, width: `${Math.max(1, (amount / scale) * 100)}%` }} /></span>
      <span className="ranking-amount">{formatMoneyValue(amount, hideAmounts)}</span>
      <span className="ranking-share">{formatShare(share)}</span>
    </>
  );
}

function wniLabel(name) {
  return name === "uncategorized" ? "Unassigned" : titleCase(name);
}

function WniSplitBar({ hideAmounts, rows }) {
  const parts = wniSplit(rows);
  if (!parts.length) {
    return null;
  }
  return (
    <div className="wni-split">
      <h3 className="wni-split-title">Want / Need / Investment</h3>
      <div aria-label={parts.map((part) => `${wniLabel(part.name)} ${formatShare(part.share)}`).join(", ")} className="wni-split-bar" role="img">
        {parts.map((part) => (
          <span key={part.name} style={{ background: wniColor(part.name), width: `${part.share * 100}%` }} title={`${wniLabel(part.name)} ${formatShare(part.share)}`} />
        ))}
      </div>
      <ul className="wni-split-legend">
        {parts.map((part) => (
          <li key={part.name}>
            <span aria-hidden="true" className="cell-dot" style={{ background: wniColor(part.name) }} />
            {wniLabel(part.name)} {formatMoneyValue(part.amount, hideAmounts)} · {formatShare(part.share)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyChart() {
  return <div className="chart-empty">No data</div>;
}
