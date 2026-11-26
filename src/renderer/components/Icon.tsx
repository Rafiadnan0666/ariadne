import React from 'react'

export type IconName =
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'
  | 'home'
  | 'plus'
  | 'close'
  | 'pin'
  | 'volume'
  | 'mute'
  | 'sparkle'
  | 'download'
  | 'history'
  | 'settings'
  | 'star'
  | 'search'
  | 'shield'
  | 'folder'
  | 'trash'
  | 'pause'
  | 'play'
  | 'retry'
  | 'external'
  | 'globe'
  | 'lock'
  | 'copy'
  | 'panel'
  | 'chevron'
  | 'check'
  | 'alert'
  | 'bot'
  | 'alert-triangle'

const PATHS: Record<IconName, React.ReactNode> = {
  back: <polyline points="15 18 9 12 15 6" />,
  forward: <polyline points="9 18 15 12 9 6" />,
  reload: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </>
  ),
  stop: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  close: (
    <>
      <line x1="7" y1="7" x2="17" y2="17" />
      <line x1="17" y1="7" x2="7" y2="17" />
    </>
  ),
  pin: (
    <>
      <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
      <line x1="12" y1="14" x2="12" y2="21" />
    </>
  ),
  volume: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 6a9 9 0 0 1 0 12" />
    </>
  ),
  mute: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <line x1="16" y1="9" x2="21" y2="15" />
      <line x1="21" y1="9" x2="16" y2="15" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5 13.8 9l5.2 1.8-5.2 1.8L12 18l-1.8-5.4L5 10.8 10.2 9 12 3.5Z" />
      <path d="M18.5 16.5 19.3 19l2.2.8-2.2.8-.8 2.4-.8-2.4-2.2-.8 2.2-.8.8-2.5Z" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </>
  ),
  settings: (
    <>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </>
  ),
  star: (
    <polygon points="12 2.5 15 9 22 9.8 16.8 14.6 18.2 21.5 12 18 5.8 21.5 7.2 14.6 2 9.8 9 9 12 2.5" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.2" y1="16.2" x2="21" y2="21" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  trash: (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>
  ),
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </>
  ),
  play: <path d="M7 4.5 19 12 7 19.5v-15Z" />,
  retry: (
    <>
      <path d="M3 12a9 9 0 1 0 2.64-6.36" />
      <polyline points="3 3 3 9 9 9" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </>
  ),
  chevron: <polyline points="6 9 12 15 18 9" />,
  check: <polyline points="4 12 9 17 20 6" />,
  alert: (
    <>
      <path d="M12 3 22 20H2L12 3Z" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  bot: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="9" r="1.5" />
      <circle cx="16" cy="9" r="1.5" />
      <path d="M5 15h14" />
      <path d="M8 15v-2" />
      <path d="M16 15v-2" />
    </>
  ),
  'alert-triangle': (
    <>
      <path d="M12 3 22 20H2L12 3Z" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
}

export const Icon: React.FC<{ name: IconName; size?: number; className?: string; filled?: boolean }> = ({
  name,
  size = 16,
  className,
  filled,
}) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={filled ? 0 : 1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {PATHS[name]}
  </svg>
)
