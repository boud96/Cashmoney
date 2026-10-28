import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { CloseIcon, FileIcon } from "./icons.jsx";
import {
  addDays,
  addMonths,
  calendarWeeks,
  formatBytes,
  formatDateInput,
  parseDateInput,
  tagToggleStyle,
  todayInputValue,
} from "./shared.js";

const modalStack = [];

export function Select({ blank, defaultValue = "", name, onChange, options, required = false, value }) {
  const controlledProps = value === undefined ? { defaultValue } : { value };
  return (
    <select {...controlledProps} name={name} onChange={onChange} required={required}>
      {blank && <option value="">{blank}</option>}
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  );
}

export function LoadingButton({ busy = false, busyLabel = "Working", children, className = "", disabled = false, onClick, type, ...props }) {
  // A busy button stays focusable (aria-disabled, clicks ignored) instead of disabled:
  // a disabled button drops focus to the page, so focus couldn't return to it when a
  // dialog it opened closes. A busy submit button stays disabled, because Enter in its
  // form would submit again.
  const keepsFocus = busy && type !== "submit";
  return (
    <button
      {...props}
      aria-busy={busy || undefined}
      aria-disabled={keepsFocus || undefined}
      className={`${className} ${busy ? "is-loading" : ""}`.trim()}
      disabled={keepsFocus ? false : disabled || busy}
      onClick={keepsFocus ? undefined : onClick}
      type={type}
    >
      {busy && <Spinner />}
      <span>{busy ? busyLabel : children}</span>
    </button>
  );
}

export function Spinner() {
  return <span aria-hidden="true" className="loading-spinner" />;
}

export function HelpTooltip({ text }) {
  return (
    <span className="help-tooltip">
      <button aria-label={text} className="help-tooltip-button" type="button">?</button>
      <span className="help-tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}

// Tags as pills that switch on and off: filled in the tag's colour with a ✓ when on,
// outlined in it when off. options are [value, label] pairs (all tags if left out);
// values that aren't tags, like the tag filter's Untagged and Tagged, get grey dashed pills.
export function TagToggleList({ disabled = false, emptyText = "No tags", label, onToggle, options, tags, value }) {
  const colors = new Map(tags.map((tag) => [tag.id, tag.color]));
  const shown = options || tags.map((tag) => [tag.id, tag.name]);
  const selected = new Set(value || []);
  if (!shown.length) {
    return <span className="muted">{emptyText}</span>;
  }
  return (
    <div aria-label={label} className="tag-toggle-list" role="group">
      {shown.map(([optionValue, text]) => {
        const isOn = selected.has(optionValue);
        const isTag = colors.has(optionValue);
        return (
          <button
            aria-pressed={isOn}
            className={["tag-toggle", isOn ? "is-on" : "", isTag ? "" : "is-special"].filter(Boolean).join(" ")}
            disabled={disabled}
            key={optionValue}
            onClick={() => onToggle(optionValue)}
            style={isTag ? tagToggleStyle(colors.get(optionValue)) : undefined}
            title={text}
            type="button"
          >
            {isOn ? <span aria-hidden="true" className="tag-toggle-check">✓</span> : null}
            <span className="tag-toggle-label">{text}</span>
          </button>
        );
      })}
    </div>
  );
}

export function CloseButton({ className = "", label = "Close", ...props }) {
  return (
    <button {...props} aria-label={label} className={`icon-button ${className}`.trim()} title={label} type="button">
      <CloseIcon />
    </button>
  );
}

// Tabs that switch a view in place. Arrow keys, Home and End move between them and
// select as they go; only the selected tab is in the Tab order. Pair each panel with
// tabPanelProps(idPrefix, id).
export function Tabs({ className = "", idPrefix, label, onChange, tabs, value }) {
  const tabRefs = useRef(new Map());

  function select(index) {
    const tab = tabs[(index + tabs.length) % tabs.length];
    onChange(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  }

  function moveOnKey(event, index) {
    const targets = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: tabs.length - 1 };
    if (event.key in targets) {
      event.preventDefault();
      select(targets[event.key]);
    }
  }

  return (
    <div aria-label={label} className={`tabs ${className}`.trim()} role="tablist">
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            aria-controls={selected ? `${idPrefix}-panel-${tab.id}` : undefined}
            aria-selected={selected}
            className={`tab ${selected ? "is-active" : ""}`.trim()}
            id={`${idPrefix}-tab-${tab.id}`}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => moveOnKey(event, index)}
            ref={(element) => {
              if (element) {
                tabRefs.current.set(tab.id, element);
              } else {
                tabRefs.current.delete(tab.id);
              }
            }}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge !== null && tab.badge !== "" ? <span className="tab-badge">{tab.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function tabPanelProps(idPrefix, id) {
  return { "aria-labelledby": `${idPrefix}-tab-${id}`, id: `${idPrefix}-panel-${id}`, role: "tabpanel" };
}

// A button that opens a small panel under it (a filter list, a menu). A click or focus
// outside closes it; Escape closes it and returns focus to the button. children can be
// a function that receives close(). The panel flips to the button's right edge when it
// would leave the window.
export function PopoverButton({ active = false, buttonProps = {}, children, className = "", content, label, popoverClassName = "" }) {
  const [open, setOpen] = useState(false);
  const [alignEnd, setAlignEnd] = useState(false);
  const anchorRef = useRef(null);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const popoverId = useId();

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) {
      buttonRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function closeIfOutside(event) {
      if (!anchorRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    // Escape closes it from anywhere: focus can drop to the page while the panel is
    // open (a button inside it gets disabled while it saves).
    function closeOnEscape(event) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        close(true);
      }
    }
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("focusin", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("focusin", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [close, open]);

  useLayoutEffect(() => {
    if (!open) {
      setAlignEnd(false);
      return;
    }
    const rect = popoverRef.current?.getBoundingClientRect();
    if (rect && rect.right > document.documentElement.clientWidth - 8) {
      setAlignEnd(true);
    }
  }, [open]);

  return (
    <div className="popover-anchor" ref={anchorRef}>
      <button
        {...buttonProps}
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={["popover-button", className, active ? "is-active" : "", open ? "is-open" : ""].filter(Boolean).join(" ")}
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        {content}
      </button>
      {open ? (
        <div
          aria-label={label}
          className={["popover", popoverClassName, alignEnd ? "is-align-end" : ""].filter(Boolean).join(" ")}
          id={popoverId}
          ref={popoverRef}
          role="dialog"
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

// Keeps an element as tall as the window below it (at least min), so a table fills the
// screen instead of scrolling inside a fixed box. Follows window resizes and layout
// changes above it (the filter bar wrapping, a warning appearing).
export function useFillHeight(ref, { bottomGap = 24, min = 360 } = {}) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }
    let frame = 0;
    function update() {
      const top = element.getBoundingClientRect().top + window.scrollY;
      const height = `${Math.max(min, Math.floor(window.innerHeight - top - bottomGap))}px`;
      if (element.style.height !== height) {
        element.style.height = height;
      }
    }
    function schedule() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    }
    update();
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(element.closest(".main") || document.body);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [bottomGap, min, ref]);
}

// A file input in the app's style: the chosen file's name and size and a button; a file
// can also be dropped on it. The native input stays in the Tab order (visually hidden),
// so the keyboard still works.
export function FilePicker({ accept, buttonLabel = "Choose…", disabled = false, emptyLabel = "No file chosen", file, inputRef, label, onChange }) {
  const [dragging, setDragging] = useState(false);

  function dragOver(event) {
    event.preventDefault();
    setDragging(!disabled);
  }

  function drop(event) {
    event.preventDefault();
    setDragging(false);
    if (!disabled && event.dataTransfer.files?.length) {
      onChange(event.dataTransfer.files[0]);
    }
  }

  return (
    <label
      className={["file-picker", dragging && "is-dragging", disabled && "is-disabled"].filter(Boolean).join(" ")}
      onDragEnter={dragOver}
      onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget) && setDragging(false)}
      onDragOver={dragOver}
      onDrop={drop}
    >
      <input
        accept={accept}
        aria-label={label}
        className="visually-hidden"
        disabled={disabled}
        onChange={(event) => onChange(event.target.files?.[0] || null)}
        ref={inputRef}
        type="file"
      />
      <FileIcon />
      <span className={`file-picker-name ${file ? "" : "is-empty"}`.trim()}>{file ? file.name : emptyLabel}</span>
      {file ? <span className="file-picker-size">{formatBytes(file.size)}</span> : null}
      <span className="file-picker-button">{buttonLabel}</span>
    </label>
  );
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container) {
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => element.getClientRects().length > 0);
}

// Where focus goes when a dialog opens: the given element; else the dialog itself when
// it is focusable (tabIndex -1); else its first field, skipping the header's close button.
function initialFocusTarget(dialog, initialFocusRef) {
  if (initialFocusRef?.current) {
    return initialFocusRef.current;
  }
  if (dialog.hasAttribute("tabindex")) {
    return dialog;
  }
  const elements = focusableElements(dialog);
  return elements.find((element) => !element.classList.contains("icon-button")) || elements[0] || null;
}

// The topmost open dialog owns the keyboard: Escape closes it, Tab and Shift+Tab wrap
// around inside it. Focus moves into a dialog when it opens and returns to where it was
// (usually the button that opened it) when it closes.
function useModalBehavior(onClose, { closeDisabled = false, dialogRef, initialFocusRef } = {}) {
  const modalIdRef = useRef(Symbol("modal"));
  // Read during the first render: effects run children first, and dialog content may
  // already have focused one of its fields by the time this hook's effect runs.
  const previousFocusRef = useRef(undefined);
  if (previousFocusRef.current === undefined) {
    previousFocusRef.current = document.activeElement;
  }

  useEffect(() => {
    const modalId = modalIdRef.current;
    modalStack.push(modalId);
    const previousFocus = previousFocusRef.current;
    const dialog = dialogRef?.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      initialFocusTarget(dialog, initialFocusRef)?.focus({ preventScroll: true });
    }
    return () => {
      const index = modalStack.indexOf(modalId);
      if (index >= 0) {
        modalStack.splice(index, 1);
      }
      const active = document.activeElement;
      const focusLeftWithDialog = !active || active === document.body || Boolean(dialog?.contains(active));
      if (focusLeftWithDialog && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const modalId = modalIdRef.current;
    function handleKeyDown(event) {
      if (modalStack[modalStack.length - 1] !== modalId) {
        return;
      }
      if (event.key === "Escape") {
        if (!closeDisabled) {
          event.preventDefault();
          onClose?.();
        }
        return;
      }
      const dialog = dialogRef?.current;
      if (event.key !== "Tab" || !dialog) {
        return;
      }
      const elements = focusableElements(dialog);
      const active = document.activeElement;
      if (!elements.length) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!dialog.contains(active) || active === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeDisabled, dialogRef, initialFocusRef, onClose]);
}

// For dialogs rendered conditionally inside an always-mounted component: render this
// next to the open dialog element (in the same backdrop) for Escape and focus handling.
export function ModalEscape({ onClose }) {
  const markerRef = useRef(null);
  const dialogRef = useRef(null);
  useLayoutEffect(() => {
    dialogRef.current = markerRef.current?.parentElement?.querySelector("[role='dialog']") || null;
  }, []);
  useModalBehavior(onClose, { dialogRef });
  return <span hidden ref={markerRef} />;
}

export function ModalShell({
  children,
  className = "",
  closeDisabled = false,
  closeLabel = "Close",
  description = "",
  headerClassName = "",
  onClose,
  title,
  titleId,
}) {
  const generatedTitleId = useId();
  const dialogTitleId = titleId || generatedTitleId;
  const dialogRef = useRef(null);

  useModalBehavior(onClose, { closeDisabled, dialogRef });

  function closeFromBackdrop(event) {
    if (event.target === event.currentTarget && !closeDisabled) {
      onClose?.();
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={closeFromBackdrop} role="presentation">
      <div
        aria-labelledby={dialogTitleId}
        aria-modal="true"
        className={className}
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className={`action-modal-header ${headerClassName}`.trim()}>
          <div className="action-modal-title-block">
            <h2 id={dialogTitleId}>{title}</h2>
            {description ? <p className="action-modal-description">{description}</p> : null}
          </div>
          <CloseButton disabled={closeDisabled} label={closeLabel} onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  danger = false,
  message,
  onCancel,
  onConfirm,
  title = "Confirm action",
}) {
  const cancelButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const titleId = useId();

  useModalBehavior(onCancel, { dialogRef, initialFocusRef: cancelButtonRef });

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
      role="presentation"
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={`confirm-modal ${danger ? "is-danger" : ""}`.trim()}
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <div className="confirm-modal-header">
          <h2 id={titleId}>{title}</h2>
        </div>
        <div className="confirm-modal-message">{message}</div>
        <div className="confirm-modal-actions">
          <button className="link-button" onClick={onCancel} ref={cancelButtonRef} type="button">
            {cancelLabel}
          </button>
          <button className={danger ? "danger-button" : "primary-action"} onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function CalendarIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <rect height="18" rx="2" width="18" x="3" y="4" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

// A YYYY-MM-DD text field with a calendar button. Typed text is applied only once it is
// a complete, real date, so half-typed text never reaches the filters; a day picked in
// the calendar is applied at once. rangeFrom/rangeTo shade the whole range in the calendar.
export function DateField({ firstYear, label, name, onChange, rangeFrom = "", rangeTo = "", value = "" }) {
  const [text, setText] = useState(value);
  const [shownValue, setShownValue] = useState(value);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const fieldRef = useRef(null);
  const inputRef = useRef(null);
  const buttonRef = useRef(null);
  const inputId = useId();
  const hintId = useId();
  if (value !== shownValue) {
    // Set from elsewhere (a saved filter, the relative range, the calendar): show it.
    setShownValue(value);
    setText(value);
  }
  // Not while typing it, unless it's already as long as a date: no red on every keystroke.
  const showInvalid = Boolean(text) && !parseDateInput(text) && (!focused || text.length >= 10);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function closeIfOutside(event) {
      if (!fieldRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    // focusin, not blur: day buttons are re-created when the month changes, and the
    // blur of a removed button would close the calendar mid-navigation.
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("focusin", closeIfOutside);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("focusin", closeIfOutside);
    };
  }, [open]);

  function changeText(event) {
    const next = event.target.value;
    setText(next);
    if (!next || parseDateInput(next)) {
      onChange(name, next);
    }
  }

  function closeCalendar(returnFocus) {
    setOpen(false);
    if (returnFocus) {
      buttonRef.current?.focus();
    }
  }

  function closeOnEscape(event) {
    if (open && event.key === "Escape") {
      event.preventDefault();
      closeCalendar(event.target !== inputRef.current);
    }
  }

  return (
    <div className="date-field" onKeyDown={closeOnEscape} ref={fieldRef}>
      <label htmlFor={inputId}><span>{label}</span></label>
      <div className="date-field-control">
        <input
          aria-describedby={showInvalid ? hintId : undefined}
          aria-invalid={showInvalid || undefined}
          id={inputId}
          inputMode="numeric"
          onBlur={() => setFocused(false)}
          onChange={changeText}
          onFocus={() => setFocused(true)}
          placeholder="YYYY-MM-DD"
          ref={inputRef}
          type="text"
          value={text}
        />
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`Choose ${label} date`}
          className="date-field-button"
          onClick={() => setOpen((current) => !current)}
          ref={buttonRef}
          type="button"
        >
          <CalendarIcon />
        </button>
      </div>
      {showInvalid ? <span className="date-field-hint" id={hintId}>Not applied: use YYYY-MM-DD</span> : null}
      {open ? (
        <DateCalendar
          firstYear={firstYear}
          label={label}
          onPick={(dateText) => {
            setText(dateText); // also when it's the applied date, replacing a half-typed one
            onChange(name, dateText);
            closeCalendar(true);
          }}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
          value={value}
        />
      ) : null}
    </div>
  );
}

// The month view: Monday first, the field's date selected, today outlined, the range
// shaded. The arrow keys move by day and week, Page Up/Down by month (with Shift, by
// year), Home/End to the week's start and end; Enter picks.
function DateCalendar({ firstYear, label, onPick, rangeFrom, rangeTo, value }) {
  const today = todayInputValue();
  // The day that takes focus in the grid; the calendar always shows its month.
  const [focusDay, setFocusDay] = useState(() => (parseDateInput(value) ? value : today));
  const [shownValue, setShownValue] = useState(value);
  const calendarRef = useRef(null);
  const focusDayOnRender = useRef(true); // when it opens, and after keyboard moves
  if (value !== shownValue) {
    // Typed into the field while the calendar is open: follow it, without taking focus.
    setShownValue(value);
    if (parseDateInput(value)) {
      setFocusDay(value);
    }
  }
  const focusDate = parseDateInput(focusDay);
  const year = focusDate.getFullYear();
  const month = focusDate.getMonth();
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let option = Math.min(firstYear || thisYear - 5, year); option <= Math.max(thisYear + 1, year); option += 1) {
    years.push(option);
  }
  const from = parseDateInput(rangeFrom) ? rangeFrom : "";
  const to = parseDateInput(rangeTo) ? rangeTo : "";
  const hasRange = Boolean(from && to && from <= to);

  useEffect(() => {
    if (focusDayOnRender.current) {
      focusDayOnRender.current = false;
      calendarRef.current?.querySelector(`[data-date="${focusDay}"]`)?.focus();
    }
  }, [focusDay]);

  function showMonth(nextYear, nextMonth) {
    const lastDay = new Date(nextYear, nextMonth + 1, 0).getDate();
    setFocusDay(formatDateInput(new Date(nextYear, nextMonth, Math.min(focusDate.getDate(), lastDay))));
  }

  function moveWithKeyboard(event) {
    const weekday = (focusDate.getDay() + 6) % 7;
    const moves = {
      ArrowLeft: () => addDays(focusDate, -1),
      ArrowRight: () => addDays(focusDate, 1),
      ArrowUp: () => addDays(focusDate, -7),
      ArrowDown: () => addDays(focusDate, 7),
      Home: () => addDays(focusDate, -weekday),
      End: () => addDays(focusDate, 6 - weekday),
      PageUp: () => addMonths(focusDate, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focusDate, event.shiftKey ? 12 : 1),
    };
    if (moves[event.key]) {
      event.preventDefault();
      focusDayOnRender.current = true;
      setFocusDay(formatDateInput(moves[event.key]()));
    }
  }

  return (
    <div aria-label={`Choose ${label} date`} className="date-calendar" ref={calendarRef} role="dialog">
      <div className="date-calendar-header">
        <button aria-label="Previous month" className="date-calendar-nav" onClick={() => showMonth(year, month - 1)} type="button">
          ‹
        </button>
        <select aria-label="Month" onChange={(event) => showMonth(year, Number(event.target.value))} value={month}>
          {MONTH_NAMES.map((monthName, index) => <option key={monthName} value={index}>{monthName}</option>)}
        </select>
        <select aria-label="Year" onChange={(event) => showMonth(Number(event.target.value), month)} value={year}>
          {years.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <button aria-label="Next month" className="date-calendar-nav" onClick={() => showMonth(year, month + 1)} type="button">
          ›
        </button>
      </div>
      <table aria-label={`${MONTH_NAMES[month]} ${year}`} className="date-calendar-grid" onKeyDown={moveWithKeyboard} role="grid">
        <thead>
          <tr>
            {WEEKDAY_NAMES.map((weekdayName) => <th abbr={weekdayName} key={weekdayName} scope="col">{weekdayName.slice(0, 2)}</th>)}
          </tr>
        </thead>
        <tbody>
          {calendarWeeks(year, month).map((week) => (
            <tr key={formatDateInput(week[0])}>
              {week.map((day, weekday) => {
                const dayText = formatDateInput(day);
                const isRangeEnd = dayText === from || dayText === to;
                const className = [
                  "date-calendar-day",
                  day.getMonth() !== month ? "is-outside" : "",
                  dayText === today ? "is-today" : "",
                  hasRange && dayText > from && dayText < to ? "is-in-range" : "",
                  isRangeEnd && dayText !== value ? "is-range-end" : "",
                  dayText === value ? "is-selected" : "",
                ].filter(Boolean).join(" ");
                return (
                  <td aria-selected={dayText === value || undefined} key={dayText}>
                    <button
                      aria-current={dayText === today ? "date" : undefined}
                      aria-label={`${WEEKDAY_NAMES[weekday]} ${day.getDate()} ${MONTH_NAMES[day.getMonth()]} ${day.getFullYear()}`}
                      className={className}
                      data-date={dayText}
                      onClick={() => onPick(dayText)}
                      tabIndex={dayText === focusDay ? 0 : -1}
                      type="button"
                    >
                      {day.getDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="date-calendar-footer">
        <button className="link-button" onClick={() => onPick(today)} type="button">Today</button>
      </div>
    </div>
  );
}
