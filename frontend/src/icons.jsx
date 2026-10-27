// Line icons in the text colour (currentColor). Decorative: the button or text next to
// them carries the accessible name.
export function IconSvg({ children, className = "", size = 18 }) {
  return (
    <svg aria-hidden="true" className={`icon-svg ${className}`.trim()} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
      {children}
    </svg>
  );
}

export function CloseIcon({ size = 16 }) {
  return (
    <IconSvg size={size}>
      <path d="M6 6l12 12M18 6L6 18" />
    </IconSvg>
  );
}

export function PencilIcon({ size = 16 }) {
  return (
    <IconSvg size={size}>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </IconSvg>
  );
}

export function TrashIcon({ size = 18 }) {
  return (
    <IconSvg size={size}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4h6v3" />
    </IconSvg>
  );
}

// Points right when closed and down when open.
export function ChevronIcon({ open = false, size = 16 }) {
  return (
    <IconSvg className={`chevron-icon ${open ? "is-open" : ""}`.trim()} size={size}>
      <path d="m9 6 6 6-6 6" />
    </IconSvg>
  );
}

export function LockIcon({ locked, size = 18 }) {
  return (
    <IconSvg size={size}>
      {locked ? (
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      ) : (
        <path d="M7 11V7a5 5 0 0 1 9.5-2.2" />
      )}
      <rect height="10" rx="2" width="14" x="5" y="11" />
    </IconSvg>
  );
}

export function InfoIcon({ size = 18 }) {
  return (
    <IconSvg size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </IconSvg>
  );
}

export function WarningIcon({ size = 14 }) {
  return (
    <IconSvg size={size}>
      <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </IconSvg>
  );
}

export function FileIcon({ size = 16 }) {
  return (
    <IconSvg size={size}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </IconSvg>
  );
}

export function MoonIcon() {
  return (
    <IconSvg>
      <path d="M12 3a6.8 6.8 0 0 0 9 8.9A9 9 0 1 1 12 3Z" />
    </IconSvg>
  );
}

export function SunIcon() {
  return (
    <IconSvg>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </IconSvg>
  );
}

export function EyeIcon() {
  return (
    <IconSvg>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </IconSvg>
  );
}

export function EyeOffIcon() {
  return (
    <IconSvg>
      <path d="m3 3 18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.9 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.2 17.2 0 0 1-2.2 3.2" />
      <path d="M6.2 6.5C3.5 8.2 2 12 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4.2-.8" />
    </IconSvg>
  );
}
