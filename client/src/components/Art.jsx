import React, { useState } from 'react';

// Thumbnail/cover with the striped placeholder behind it, so a missing or broken image
// still keeps the layout. `ratio` is a CSS aspect-ratio ("16 / 9", "1").
export default function Art({ src, alt = '', ratio = '16 / 9', className = '', children, label }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const failed = !!src && failedSrc === src;
  return (
    <div className={`art ${className}`} style={{ aspectRatio: ratio }}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" onError={() => setFailedSrc(src)} />
      ) : label ? (
        <span className="art-label">{label}</span>
      ) : null}
      {children}
    </div>
  );
}
