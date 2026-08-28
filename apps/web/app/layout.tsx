import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hawker — sell your API to AI agents',
  description: 'Turn your API into an agent-payable product in 5 minutes.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
