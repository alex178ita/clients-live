import './globals.css';

export const metadata = {
  title: 'Won Clients & Kleecks Live Status',
  description: 'Won clients with licence dates, channel and live Kleecks detection on their website'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
