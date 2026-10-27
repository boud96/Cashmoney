// The dashboard's charts.
import { lazy, Suspense } from "react";

import {
  baseLayout,
  completeMonthlyRows,
  cssVar,
  formatMoneyValue,
  sunburstData,
  titleCase,
  topExpenseSubcategories,
  wniColor,
} from "../../shared.js";

// Plotly loads as its own chunk (see PlotlyChart.jsx); ChartPanel shows a placeholder meanwhile.
const Plot = lazy(() => import("../../PlotlyChart.jsx"));

export function ChartPanel({ children, className = "", ready = true, title }) {
  const loading = <div className="chart-empty">Loading chart…</div>;
  return (
    <section className={`panel chart-panel ${className}`}>
      <div className="panel-header"><h2>{title}</h2></div>
      {ready ? <Suspense fallback={loading}>{children}</Suspense> : loading}
    </section>
  );
}

export function MonthlyChart({ hideAmounts, rows }) {
  const monthlyRows = completeMonthlyRows(rows);
  if (!monthlyRows.length) return <EmptyChart />;
  const months = monthlyRows.map((row) => row.month);
  const incomes = monthlyRows.map((row) => row.income);
  const expenses = monthlyRows.map((row) => -row.expense);
  const net = monthlyRows.map((row) => row.net);
  const monthlyHoverData = monthlyRows.map((row) => [
    formatMoneyValue(row.income, hideAmounts),
    formatMoneyValue(row.expense, hideAmounts),
    formatMoneyValue(row.net, hideAmounts),
  ]);
  const barWidth = monthlyRows.map(() => 0.78);
  const netColors = monthlyRows.map(() => cssVar("--net-overlay", "rgba(230, 237, 243, 0.26)"));
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[
        {
          customdata: monthlyHoverData,
          hovertemplate: "Incomes: %{customdata[0]}<extra></extra>",
          marker: { color: cssVar("--green", "#2f8f65") },
          name: "Incomes",
          type: "bar",
          width: barWidth,
          x: months,
          y: incomes,
        },
        {
          customdata: monthlyHoverData,
          hovertemplate: "Expenses: %{customdata[1]}<extra></extra>",
          marker: { color: cssVar("--red", "#dc2626") },
          name: "Expenses",
          type: "bar",
          width: barWidth,
          x: months,
          y: expenses,
        },
        {
          customdata: monthlyHoverData,
          hovertemplate: "Net: %{customdata[2]}<extra></extra>",
          marker: {
            color: netColors,
            line: { width: 0 },
          },
          name: "Net",
          type: "bar",
          width: barWidth,
          x: months,
          y: net,
        },
      ]}
      layout={baseLayout({
        bargap: 0.24,
        barmode: "overlay",
        hovermode: "x unified",
        xaxis: { type: "category" },
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

export function SunburstChart({ hideAmounts, rows }) {
  if (!rows.length) return <EmptyChart />;
  const { colors, ids, labels, parents, values } = sunburstData(rows);
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[{
        branchvalues: "total",
        hovertemplate: hideAmounts ? "%{label}<extra></extra>" : undefined,
        ids,
        labels,
        marker: { colors },
        parents,
        textinfo: hideAmounts ? "label" : undefined,
        type: "sunburst",
        values,
      }]}
      layout={baseLayout({ extendsunburstcolors: false, margin: { t: 8, r: 8, b: 8, l: 8 }, title: undefined })}
      useResizeHandler
    />
  );
}

export function WniChart({ hideAmounts, rows }) {
  const cleanRows = rows
    .map((row) => ({ ...row, amount: Number(row.amount || 0) }))
    .filter((row) => row.amount > 0);
  if (!cleanRows.length) return <EmptyChart />;
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[{
        hole: 0.48,
        labels: cleanRows.map((row) => titleCase(row.name)),
        hovertemplate: hideAmounts ? "%{label}<extra></extra>" : undefined,
        marker: { colors: cleanRows.map((row) => wniColor(row.name)) },
        textinfo: hideAmounts ? "label" : undefined,
        type: "pie",
        values: cleanRows.map((row) => row.amount),
      }]}
      layout={baseLayout({ margin: { t: 8, r: 8, b: 8, l: 8 }, showlegend: true })}
      useResizeHandler
    />
  );
}

export function TopExpenseChart({ hideAmounts, rows }) {
  const topRows = topExpenseSubcategories(rows);
  if (!topRows.length) return <EmptyChart />;
  const topExpenseHoverData = topRows.map((row) => formatMoneyValue(row.amount, hideAmounts));
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[{
        customdata: topExpenseHoverData,
        marker: { color: cssVar("--blue", "#58a6ff") },
        orientation: "h",
        hovertemplate: hideAmounts ? "%{y}<extra></extra>" : "%{y}<br>Amount: %{customdata}<extra></extra>",
        text: topRows.map((row) => formatMoneyValue(row.amount, hideAmounts)),
        textposition: "auto",
        type: "bar",
        x: topRows.map((row) => row.amount),
        y: topRows.map((row) => row.label),
      }]}
      layout={baseLayout({
        height: 285,
        margin: { t: 8, r: 18, b: 36, l: 150 },
        xaxis: { showticklabels: !hideAmounts },
        yaxis: { automargin: true },
      })}
      useResizeHandler
    />
  );
}

function EmptyChart() {
  return <div className="chart-empty">No data</div>;
}
