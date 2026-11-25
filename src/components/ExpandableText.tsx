import React, { useState } from 'react';

export function truncateAtWordBoundary(
  text: string,
  maxChars = 160
): { preview: string; isTruncated: boolean } {
  const safe = String(text ?? '').trim();
  if (!safe || safe.length <= maxChars) {
    return { preview: safe, isTruncated: false };
  }
  const sliced = safe.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(' ');
  const cutoff = lastSpace > Math.floor(maxChars * 0.6) ? sliced.slice(0, lastSpace) : sliced;
  return {
    preview: `${cutoff.trimEnd()}…`,
    isTruncated: true,
  };
}

interface ExpandableTextProps {
  text: string;
  maxChars?: number;
  style?: React.CSSProperties;
  className?: string;
}

export const ExpandableText: React.FC<ExpandableTextProps> = ({
  text,
  maxChars = 160,
  style,
  className,
}) => {
  const [expanded, setExpanded] = useState(false);
  const { preview, isTruncated } = truncateAtWordBoundary(text, maxChars);

  return (
    <span className={className} style={style}>
      {expanded || !isTruncated ? text : preview}
      {isTruncated && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            marginLeft: '0.35rem',
            color: 'var(--emerald-primary)',
            fontSize: '0.76rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </span>
  );
};
