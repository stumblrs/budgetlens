import React, { useState } from 'react';

interface PresidentAvatarProps {
  src: string;
  name: string;
  initials: string;
  accentColor?: string;
  size?: number;
  party?: string;
}

export const PresidentAvatar: React.FC<PresidentAvatarProps> = ({
  src,
  name,
  initials,
  accentColor = '#10b981',
  size = 56,
  party,
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div
      title={party ? `${name} (${party})` : name}
      style={{
        position: 'relative',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        border: `2.5px solid ${accentColor}`,
        backgroundColor: '#0f172a',
        overflow: 'hidden',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 12px rgba(15, 23, 42, 0.15)',
      }}
    >
      {!imgFailed ? (
        <img
          src={src}
          alt={name}
          onError={() => setImgFailed(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center 20%',
            display: 'block',
          }}
        />
      ) : (
        <span
          style={{
            color: '#ffffff',
            fontWeight: 800,
            fontSize: `${Math.round(size * 0.36)}px`,
            letterSpacing: '-0.5px',
          }}
        >
          {initials}
        </span>
      )}
    </div>
  );
};
