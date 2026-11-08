/**
 * 线性图标（24 网格、2px 描边、圆角端点）。只用于装饰与辅助识别，一律 aria-hidden，含义由旁边的文字承担。
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

interface Shape {
  /** 描边路径。 */
  d?: string[]
  /** 圆：[cx, cy, r]。 */
  c?: [number, number, number][]
  /** 填充路径（实心图形）。 */
  fill?: string[]
}

const ICONS = {
  home: { d: ['M3 11 12 4l9 7', 'M5 10v10h14V10', 'M10 20v-6h4v6'] },
  users: { d: ['M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6', 'M16 5.2a3.5 3.5 0 0 1 0 6.6', 'M21 20c0-2.6-1.5-4.8-3.7-5.6'], c: [[9, 8, 3.5]] },
  tasks: { d: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'] },
  sliders: { d: ['M4 6h9', 'M17 6h3', 'M4 12h3', 'M11 12h9', 'M4 18h11', 'M19 18h1'], c: [[15, 6, 2], [9, 12, 2], [17, 18, 2]] },
  pulse: { d: ['M3 12h4l3-7 4 14 3-7h4'] },
  search: { d: ['m20 20-4.2-4.2'], c: [[11, 11, 7]] },
  play: { fill: ['M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z'] },
  stop: { fill: ['M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z'] },
  copy: { d: ['M9 9h10v11H9z', 'M15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4'] },
  check: { d: ['m5 12.5 4.5 4.5L19 7.5'] },
  close: { d: ['M6 6l12 12', 'M18 6 6 18'] },
  alert: { d: ['M12 4 2.8 19.5h18.4z', 'M12 10v4.5', 'M12 17h.01'] },
  info: { d: ['M12 11v5.5', 'M12 7.8h.01'], c: [[12, 12, 9]] },
  lock: { d: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'] },
  bolt: { d: ['M13 3 5 13.5h6.5L10.5 21 19 10.5h-6.5z'] },
  heart: { d: ['M12 19.5s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 6.8a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10.2-7.5 10.2z'] },
  comment: { d: ['M4 5h16v11H10l-6 4.5z'] },
  star: { d: ['m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.3 2.8 1-5.9-4.2-4.1 5.9-.8z'] },
  eye: { d: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'], c: [[12, 12, 3]] },
  share: { d: ['M4 13v6h16v-6', 'M12 3.5v11', 'm7.5 8 4.5-4.5L16.5 8'] },
  download: { d: ['M12 4v11', 'm7.5 10.5 4.5 4.5 4.5-4.5', 'M4 20h16'] },
  external: { d: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'] },
  chevronRight: { d: ['m9 6 6 6-6 6'] },
  chevronDown: { d: ['m6 9 6 6 6-6'] },
  arrowLeft: { d: ['M19 12H5', 'm11 6-6 6 6 6'] },
  menu: { d: ['M4 6h16', 'M4 12h16', 'M4 18h16'] },
  refresh: { d: ['M20 11.5A8 8 0 1 0 17.7 17', 'M20 4.5v7h-7'] },
  upload: { d: ['M12 20V9', 'm7.5 13.5 4.5-4.5 4.5 4.5', 'M4 4h16'] },
  terminal: { d: ['m5 8 4 4-4 4', 'M12 17h7'] },
  logout: { d: ['M15 4h4v16h-4', 'm10 8-4 4 4 4', 'M6 12h10'] },
  user: { d: ['M4.5 20.5c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5'], c: [[12, 8, 4]] },
  clock: { d: ['M12 7v5l3.2 2'], c: [[12, 12, 9]] },
  image: { d: ['M3 5h18v14H3z', 'm21 15.5-5-5-9.5 8.5'], c: [[8.5, 9.5, 1.5]] },
  video: { d: ['M3 6.5h12.5v11H3z', 'm15.5 10.5 5.5-3v9l-5.5-3'] },
  file: { d: ['M6 3h8l4 4v14H6z', 'M14 3v4h4'] },
  folder: { d: ['M3 6.5h6l2 2h10V19H3z'] },
  more: { fill: ['M5 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM12 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM19 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z'] },
  key: { d: ['m10.8 12.2 8.7-8.7', 'm16.5 6.5 2.5 2.5'], c: [[7.5, 15.5, 4]] },
  phone: { d: ['M7.5 3h9v18h-9z', 'M11 18h2'] },
  globe: { d: ['M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'], c: [[12, 12, 9]] },
  scan: { d: ['M4 8.5V4h4.5', 'M15.5 4H20v4.5', 'M20 15.5V20h-4.5', 'M8.5 20H4v-4.5', 'M7.5 12h9'] },
  cookie: { d: ['M20.5 12.5A8.5 8.5 0 1 1 11.5 3.5a3 3 0 0 0 4 3.5 3 3 0 0 0 5 5.5z', 'M8.5 9.5h.01', 'M12 15h.01', 'M8 14.5h.01', 'M15.5 15.5h.01'] },
  trash: { d: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'] },
  sparkle: { fill: ['M12 2.5c.7 4.6 3 6.9 7.5 7.5-4.5.6-6.8 2.9-7.5 7.5-.7-4.6-3-6.9-7.5-7.5 4.5-.6 6.8-2.9 7.5-7.5z'] },
  ticket: { d: ['M3.5 7h17v3a2 2 0 0 0 0 4v3h-17v-3a2 2 0 0 0 0-4z', 'M14.5 7v10'] },
  broadcast: { d: ['M7.8 16.2a6 6 0 0 1 0-8.4', 'M16.2 7.8a6 6 0 0 1 0 8.4', 'M5 19a10 10 0 0 1 0-14', 'M19 5a10 10 0 0 1 0 14'], c: [[12, 12, 1.5]] },
} satisfies Record<string, Shape>

export type IconName = keyof typeof ICONS

/**
 * 创建一个图标元素。
 */
export function icon(name: IconName, className = 'icon'): SVGSVGElement {
  const shape: Shape = ICONS[name]
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', className)
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  for (const d of shape.d ?? []) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  }
  for (const [cx, cy, r] of shape.c ?? []) {
    const circle = document.createElementNS(SVG_NS, 'circle')
    circle.setAttribute('cx', String(cx))
    circle.setAttribute('cy', String(cy))
    circle.setAttribute('r', String(r))
    svg.appendChild(circle)
  }
  for (const d of shape.fill ?? []) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    path.setAttribute('class', 'icon-fill')
    svg.appendChild(path)
  }
  return svg
}
