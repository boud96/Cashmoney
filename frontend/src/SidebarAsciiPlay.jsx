import { useEffect, useRef } from "react";

// The ASCII ribbon behind the sidebar navigation: a canvas redrawn about 30 times a
// second while the app is in use (see the component for when it stops).

export function buildSidebarAsciiFrame(frame, size) {
  const width = size.columns;
  const height = size.rows;
  // Every cell is set below, so the rows don't need filling first.
  const rows = Array.from({ length: height }, () => new Array(width));
  const background = "   .   +   _   ";
  const ribbon = "CA$HMONEY";

  function write(row, col, text) {
    if (row < 0 || row >= height) {
      return;
    }
    String(text).split("").forEach((char, index) => {
      const x = col + index;
      if (x >= 0 && x < width) {
        rows[row][x] = char;
      }
    });
  }

  const time = frame * 0.12;
  for (let y = 0; y < height; y += 1) {
    // The ribbons' positions depend only on the row: worked out once per row, not per cell.
    const rowDrift = Math.sin(y * 0.18 + time * 0.9) * 4 + Math.sin(y * 0.07 - time * 0.55) * 7;
    const primaryCenter =
      width / 2 +
      Math.sin(y * 0.21 + time) * width * 0.22 +
      Math.sin(y * 0.055 - time * 0.7) * width * 0.08;
    const secondaryCenter =
      width / 2 +
      Math.sin(y * 0.17 - time * 0.85 + Math.PI) * width * 0.2 +
      Math.sin(y * 0.075 + time * 0.5) * width * 0.07;
    const tertiaryCenter =
      width / 2 +
      Math.sin(y * 0.13 + time * 0.7 + Math.PI / 2) * width * 0.15;
    for (let x = 0; x < width; x += 1) {
      const distance = Math.min(
        Math.abs(x - primaryCenter),
        Math.abs(x - secondaryCenter),
        Math.abs(x - tertiaryCenter),
      );

      if (distance < 0.9) {
        rows[y][x] = ribbon[Math.abs(Math.floor(x + y + time * 3)) % ribbon.length];
      } else if (distance < 2.5) {
        rows[y][x] = "+";
      } else if (distance < 4.5) {
        rows[y][x] = ".";
      } else {
        const charIndex = Math.abs(Math.floor(x + y * 0.7 + rowDrift + time * 2)) % background.length;
        rows[y][x] = background[charIndex];
      }
    }
  }

  const label = "Cashmoney";
  const labelRow = 7;
  const labelCol = Math.max(0, Math.floor((width - label.length) / 2));
  write(labelRow, labelCol, label);

  return rows.map((row) => row.join("")).join("\n");
}

const SIDEBAR_FRAME_MS = 33; // about 30 frames a second
const SIDEBAR_IDLE_MS = 2 * 60 * 1000; // stop after two minutes without input

export default function SidebarAsciiPlay() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context) {
      return undefined;
    }

    const animate = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let running = false;
    let animationFrame = 0;
    let timer = 0;
    let idleTimer = 0;
    let lastActivity = 0;
    let lastDraw = 0;
    let width = 0;
    let height = 0;
    let columns = 34;
    let rows = 64;
    let characterHeight = 10.6;
    let color = "";

    function updateSize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const pixelRatio = window.devicePixelRatio || 1;
      const styles = window.getComputedStyle(canvas);
      const font = styles.font || `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
      context.font = font;
      const characterWidth = context.measureText("M").width || 5.1;
      const parsedLineHeight = Number.parseFloat(styles.lineHeight);
      const parsedFontSize = Number.parseFloat(styles.fontSize);
      characterHeight = parsedLineHeight || parsedFontSize * 1.2 || 10.6;
      columns = Math.max(24, Math.ceil(width / characterWidth));
      rows = Math.max(24, Math.ceil(height / characterHeight));
      canvas.width = Math.ceil(width * pixelRatio);
      canvas.height = Math.ceil(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.font = font;
      context.textBaseline = "top";
    }

    // The color changes only with the theme or accent; reading it every frame was waste.
    function updateColor() {
      color = window.getComputedStyle(canvas).color;
    }

    function renderFrame(timestamp) {
      // The narrow layout hides the canvas (display: none): nothing to draw.
      if (!width || !height) {
        return;
      }
      context.fillStyle = color;
      context.clearRect(0, 0, width, height);
      const content = buildSidebarAsciiFrame(timestamp / 120, { columns, rows });
      content.split("\n").forEach((line, index) => {
        context.fillText(line, 0, index * characterHeight);
      });
    }

    function draw(timestamp) {
      if (!running) {
        return;
      }
      if (timestamp - lastDraw >= SIDEBAR_FRAME_MS - 1) {
        lastDraw = timestamp;
        renderFrame(timestamp);
      }
      // Wait on a timer until shortly before the next frame is due, instead of waking on
      // every display refresh (60 to 144 times a second) only to skip it.
      const wait = Math.max(0, lastDraw + SIDEBAR_FRAME_MS - timestamp - 12);
      timer = window.setTimeout(() => {
        animationFrame = window.requestAnimationFrame(draw);
      }, wait);
    }

    function start() {
      if (animate && !running && width && height && document.hasFocus()) {
        running = true;
        animationFrame = window.requestAnimationFrame(draw);
      }
    }

    function stop() {
      running = false;
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timer);
    }

    // The animation is decoration, so it stops while nobody is using the app: when the
    // window loses focus, or after a while without input. The last frame stays.
    function checkIdle() {
      const idleFor = performance.now() - lastActivity;
      if (idleFor >= SIDEBAR_IDLE_MS) {
        idleTimer = 0;
        stop();
      } else {
        idleTimer = window.setTimeout(checkIdle, SIDEBAR_IDLE_MS - idleFor);
      }
    }

    function noteActivity() {
      lastActivity = performance.now();
      if (!idleTimer) {
        idleTimer = window.setTimeout(checkIdle, SIDEBAR_IDLE_MS);
      }
      start();
    }

    // A still frame (reduced motion, or stopped) is drawn again only when it changes.
    function redrawStill() {
      if (!running) {
        renderFrame(lastDraw);
      }
    }

    updateSize();
    updateColor();
    lastDraw = animate ? performance.now() : 0;
    renderFrame(lastDraw);
    const activityEvents = ["pointermove", "pointerdown", "keydown", "wheel"];
    if (animate) {
      noteActivity();
      activityEvents.forEach((name) => window.addEventListener(name, noteActivity, { passive: true }));
      window.addEventListener("focus", noteActivity);
      window.addEventListener("blur", stop);
    }

    const themeObserver = new MutationObserver(() => {
      updateColor();
      redrawStill();
    });
    themeObserver.observe(document.documentElement, {
      attributeFilter: ["class", "data-theme", "style"],
      attributes: true,
    });
    const onResize = () => {
      updateSize();
      // Hidden in the narrow layout: stop. Shown again while the app is in use: go on.
      if (!width || !height) {
        stop();
      } else if (idleTimer) {
        start();
      }
      redrawStill();
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    if (resizeObserver) {
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener("resize", onResize);
    }
    return () => {
      stop();
      window.clearTimeout(idleTimer);
      activityEvents.forEach((name) => window.removeEventListener(name, noteActivity));
      window.removeEventListener("focus", noteActivity);
      window.removeEventListener("blur", stop);
      themeObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas aria-hidden="true" className="sidebar-ascii-play" ref={canvasRef} />;
}
