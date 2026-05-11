// Inline SVG icon set — stroke-based, 16px default
const Icon = ({ name, size = 16, stroke = 1.6, ...rest }) => {
  const common = {
    width: size, height: size, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: stroke,
    strokeLinecap: "round", strokeLinejoin: "round",
    ...rest
  };
  switch (name) {
    case "search":      return (<svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>);
    case "command":     return (<svg {...common}><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3"/></svg>);
    case "plus":        return (<svg {...common}><path d="M12 5v14M5 12h14"/></svg>);
    case "check":       return (<svg {...common}><path d="m5 12 5 5L20 7"/></svg>);
    case "x":           return (<svg {...common}><path d="M6 6l12 12M18 6 6 18"/></svg>);
    case "settings":    return (<svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1"/></svg>);
    case "bell":        return (<svg {...common}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/></svg>);
    case "calendar":    return (<svg {...common}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>);
    case "wallet":      return (<svg {...common}><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h16v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7"/><circle cx="17" cy="13" r="1"/></svg>);
    case "music":       return (<svg {...common}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>);
    case "heart":       return (<svg {...common}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>);
    case "briefcase":   return (<svg {...common}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>);
    case "book":        return (<svg {...common}><path d="M4 19.5V4a2 2 0 0 1 2-2h14v18H6a2 2 0 0 0-2 2z"/><path d="M8 7h8M8 11h8"/></svg>);
    case "graduation":  return (<svg {...common}><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5a6 6 0 0 0 12 0v-5"/></svg>);
    case "gamepad":     return (<svg {...common}><path d="M6 12h4M8 10v4M15 13h0M18 11h0M17.32 5H6.68a4 4 0 0 0-3.96 3.51l-1 8A4 4 0 0 0 5.68 21h0a4 4 0 0 0 3.4-1.89L10 18h4l.92 1.11A4 4 0 0 0 18.32 21h0a4 4 0 0 0 3.96-4.49l-1-8A4 4 0 0 0 17.32 5z"/></svg>);
    case "plane":       return (<svg {...common}><path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0 0-3 2.1 2.1 0 0 0-3 0L13 8 4.8 6.2l-1.2 1.2L9 11l-3 3-2 .5L3 16l3.5.5L7 20l1.4-1.4L11 14l4.6 6.4z"/></svg>);
    case "feather":     return (<svg {...common}><path d="M20.2 3.8a5.4 5.4 0 0 0-7.6 0L4 12.4V20h7.6l8.6-8.6a5.4 5.4 0 0 0 0-7.6zM16 8 2 22M17.5 15H9"/></svg>);
    case "home":        return (<svg {...common}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"/></svg>);
    case "inbox":       return (<svg {...common}><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></svg>);
    case "instagram":   return (<svg {...common}><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.5" fill="currentColor"/></svg>);
    case "send":        return (<svg {...common}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>);
    case "image":       return (<svg {...common}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>);
    case "file":        return (<svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>);
    case "download":    return (<svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>);
    case "dumbbell":    return (<svg {...common}><path d="M6 4v16M2 8v8M18 4v16M22 8v8M6 12h12"/></svg>);
    case "droplet":     return (<svg {...common}><path d="M12 2.7s5 5.5 5 10.3a5 5 0 1 1-10 0c0-4.8 5-10.3 5-10.3z"/></svg>);
    case "sparkles":    return (<svg {...common}><path d="M12 3 13.5 8 18 9.5 13.5 11 12 16l-1.5-5L6 9.5 10.5 8z"/><path d="M19 14l.6 2 2 .6-2 .6L19 19l-.6-2-2-.6 2-.6z"/></svg>);
    case "more":        return (<svg {...common}><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>);
    case "clock":       return (<svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>);
    case "external":    return (<svg {...common}><path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>);
    case "circle":      return (<svg {...common}><circle cx="12" cy="12" r="9"/></svg>);
    case "target":      return (<svg {...common}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>);
    case "phone":       return (<svg {...common}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 2 .6 3a2 2 0 0 1-.5 2L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2-.4c1 .3 2 .5 3 .6a2 2 0 0 1 1.7 2z"/></svg>);
    case "flag":        return (<svg {...common}><path d="M4 22V4M4 4h14l-3 5 3 5H4"/></svg>);
    case "trending-up": return (<svg {...common}><path d="m22 7-8.5 8.5-5-5L2 17M16 7h6v6"/></svg>);
    default:            return (<svg {...common}><circle cx="12" cy="12" r="9"/></svg>);
  }
};
window.Icon = Icon;
