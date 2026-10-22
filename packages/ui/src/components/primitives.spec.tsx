import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Button } from './Button.js';
import { Input, Select, Textarea } from './Field.js';
import { StatusBadge } from './StatusBadge.js';
import { Alert } from './Alert.js';
import { EmptyState, ErrorState, LoadingSkeleton } from './States.js';
import { Table, TBody, Td, Th, THead, Tr, TableWrap } from './Table.js';
import { PatientContextBanner } from './PatientContextBanner.js';
import { Modal } from './Modal.js';
import { SkipLink } from './SkipLink.js';

describe('Button', () => {
  it('fires onClick and supports accessible names', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save note</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('loading disables duplicate submission (UX-001 §17)', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button', { name: /please wait/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Field primitives', () => {
  it('input associates label, hint and invalid state', () => {
    render(<Input label="Facility code" hint="Unique per organisation" />);
    const input = screen.getByLabelText('Facility code');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText('Unique per organisation')).toBeInTheDocument();
  });

  it('input error is announced via role=alert', () => {
    render(<Input label="Email" error="Email is required" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Email is required');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('textarea and select expose labels', () => {
    render(
      <>
        <Textarea label="Clinical note" />
        <Select label="Triage acuity" options={[{ value: '1', label: 'Resuscitation' }]} />
      </>,
    );
    expect(screen.getByLabelText('Clinical note')).toBeInTheDocument();
    expect(screen.getByLabelText('Triage acuity')).toBeInTheDocument();
  });
});

describe('StatusBadge', () => {
  it('carries text, never colour alone (UX-001 §14)', () => {
    render(<StatusBadge tone="error" label="Critical" />);
    const badge = screen.getByText('Critical');
    expect(badge).toBeInTheDocument();
    expect(badge.closest('.pulse-badge')).toHaveClass('pulse-badge--error');
  });
});

describe('Alert', () => {
  it('errors use role=alert, info uses role=status', () => {
    const { rerender } = render(<Alert tone="error">Order failed</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Order failed');
    rerender(<Alert tone="info">Queued</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Queued');
  });
});

describe('States', () => {
  it('empty state offers a recovery action', async () => {
    const onClick = vi.fn();
    render(<EmptyState title="No appointments" action={{ label: 'Book', onClick }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Book' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('error state announces and retries (FE-001 §25)', async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('skeletons are busy-labelled for assistive tech', () => {
    render(<LoadingSkeleton rows={3} />);
    expect(screen.getByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Table', () => {
  it('renders an accessible caption and column headers', () => {
    render(
      <TableWrap>
        <Table caption="Today's clinic">
          <THead>
            <Tr>
              <Th>Time</Th>
              <Th>Patient</Th>
            </Tr>
          </THead>
          <TBody>
            <Tr>
              <Td>09:00</Td>
              <Td>Ahmad bin Rahman</Td>
            </Tr>
          </TBody>
        </Table>
      </TableWrap>,
    );
    expect(screen.getByRole('table', { name: "Today's clinic" })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Time' })).toBeInTheDocument();
  });
});

describe('PatientContextBanner', () => {
  it('keeps absent allergy data unknown rather than claiming no known allergies', () => {
    render(<PatientContextBanner patient={{ displayName: 'Test Patient', mrn: 'TEST-001', dateOfBirth: '1990-01-01' }} />);
    expect(screen.getByRole('region', { name: 'Active patient' })).toHaveTextContent('Allergies: Not recorded');
    expect(screen.queryByText('No known allergies')).toBeNull();
  });
  it('shows explicit empty state without a patient (wrong-patient prevention §7)', () => {
    render(<PatientContextBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(/no patient selected/i);
  });

  it('pins identity, MRN and allergy flags as text', () => {
    render(
      <PatientContextBanner
        patient={{
          displayName: 'Siti Nur Aisyah',
          mrn: 'P-2025-00456',
          age: 32,
          sex: 'F',
          encounter: 'OPD · Main Facility',
          allergies: 'Penicillin',
        }}
      />,
    );
    const region = screen.getByRole('region', { name: 'Active patient' });
    expect(region).toHaveTextContent('Siti Nur Aisyah');
    expect(region).toHaveTextContent('MRN P-2025-00456');
    expect(region).toHaveTextContent('Allergies: Penicillin');
  });
});

describe('Modal', () => {
  it('is a labelled modal dialog and closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal open title="End encounter" onClose={onClose}>
        <p>Confirm ending the active encounter.</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'End encounter' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders nothing when closed', () => {
    render(
      <Modal open={false} title="Hidden" onClose={() => {}}>
        <p>x</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('SkipLink', () => {
  it('jumps focus to the main landmark target', () => {
    render(
      <>
        <SkipLink targetId="main-content" />
        <main id="main-content" tabIndex={-1} />
      </>,
    );
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link).toHaveAttribute('href', '#main-content');
  });
});
