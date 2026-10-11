import Plotly from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";

// Plotly is about 4.5 MB, most of the app's JavaScript. DashboardPage loads this module
// with React.lazy, so Plotly gets its own chunk and the grid and filters don't wait for it.
export default createPlotlyComponent(Plotly);
