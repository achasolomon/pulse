import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import '@pulse/ui/styles.css';
import './globals.css';
import '../components/patient-record-header.css';
import '../components/current-encounter.css';
import '../components/latest-vital-signs.css';
import '../components/clinical-summary-cards.css';
import '../components/note-workspace.css';
import '../components/rich-note-editor.css';
import { pulseTokensCss } from '@pulse/ui';

export const metadata: Metadata = {
  title: 'Pulse Clinical',
  description: 'Pulse Connected Care — clinical operations',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <style data-pulse-tokens dangerouslySetInnerHTML={{ __html: pulseTokensCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
