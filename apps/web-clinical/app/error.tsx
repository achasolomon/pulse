'use client';
import { Button, Card } from '@pulse/ui';
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="login"><Card className="login__card">
    <h1 className="login__title">Pulse is temporarily unavailable</h1>
    <p>Your workspace could not be verified. Try again when the service is available.</p>
    <Button onClick={reset}>Try again</Button>
    <a href="/login">Return to sign in</a>
  </Card></main>;
}
