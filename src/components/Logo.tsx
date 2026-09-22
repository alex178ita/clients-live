'use client';

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';

/**
 * Official white Kleecks wordmark (`public/kleecks-logo-white.webp`).
 * Falls back to a plain text wordmark if the file is ever missing.
 */
export default function Logo({ className = 'h-8 w-auto' }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className="text-xl font-semibold tracking-tight text-white">kleecks</span>;
  }
  return (
    <img
      src="/kleecks-logo-white.webp"
      alt="Kleecks"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
