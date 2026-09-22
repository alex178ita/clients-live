'use client';

import Logo from './Logo';

export default function Splash({ message }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-ink">
      <Logo className="h-12 w-auto" />
      <div className="spinner" />
      <p className="text-sm tracking-wide text-muted">
        {message ?? 'Loading data ... please wait ...'}
      </p>
    </div>
  );
}
