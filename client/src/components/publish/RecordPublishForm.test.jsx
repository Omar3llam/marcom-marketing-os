// ============================================================
// RecordPublishForm Component Tests
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecordPublishForm } from './RecordPublishForm.jsx';

// Control the hook so we can assert calls + drive each render branch.
const recordPublish = vi.fn();
const reset = vi.fn();
let hookState;

vi.mock('../../hooks/useRecordPublish.js', () => ({
  useRecordPublish: () => hookState,
}));

const approved = {
  id: 'artifact-1',
  type: 'hook',
  approval: { id: 'ap-1', status: 'COMPLETED', decision: 'APPROVED' },
};

beforeEach(() => {
  vi.clearAllMocks();
  hookState = { recordPublish, submitting: false, error: null, published: null, reset };
});

describe('RecordPublishForm — approval gating', () => {
  it('renders nothing for a PENDING artifact', () => {
    const { container } = render(
      <RecordPublishForm artifact={{ ...approved, approval: { status: 'PENDING' } }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the decision is not APPROVED', () => {
    const { container } = render(
      <RecordPublishForm artifact={{ ...approved, approval: { status: 'COMPLETED', decision: 'REJECTED' } }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the CTA for an APPROVED artifact', () => {
    render(<RecordPublishForm artifact={approved} />);
    expect(screen.getByRole('button', { name: /Record Meta publish/i })).toBeInTheDocument();
  });
});

describe('RecordPublishForm — entry + validation', () => {
  it('requires the ad ID and campaign ID before calling the API', () => {
    render(<RecordPublishForm artifact={approved} />);
    fireEvent.click(screen.getByRole('button', { name: /Record Meta publish/i }));

    // Submit with both required fields empty.
    fireEvent.click(screen.getByRole('button', { name: /^Record publish$/i }));

    expect(recordPublish).not.toHaveBeenCalled();
    expect(screen.getByText(/required/i)).toBeInTheDocument();
  });

  it('submits the entered Meta IDs to recordPublish', () => {
    render(<RecordPublishForm artifact={approved} />);
    fireEvent.click(screen.getByRole('button', { name: /Record Meta publish/i }));

    fireEvent.change(screen.getByLabelText(/Meta ad ID/i), { target: { value: 'ad-123' } });
    fireEvent.change(screen.getByLabelText(/Meta campaign ID/i), { target: { value: 'camp-123' } });
    fireEvent.click(screen.getByRole('button', { name: /^Record publish$/i }));

    expect(recordPublish).toHaveBeenCalledWith(
      'artifact-1',
      expect.objectContaining({ metaAdId: 'ad-123', metaCampaignId: 'camp-123' })
    );
  });
});

describe('RecordPublishForm — honest states', () => {
  it('surfaces a mapped server error inside the form', () => {
    hookState.error = 'This artifact is already linked to a published Meta ad. Each ad ID can only be recorded once.';
    render(<RecordPublishForm artifact={approved} />);
    fireEvent.click(screen.getByRole('button', { name: /Record Meta publish/i }));

    expect(screen.getByText(/already linked to a published Meta ad/i)).toBeInTheDocument();
  });

  it('shows the recorded confirmation once published', () => {
    hookState.published = { id: 'pub-1', metaAdId: 'ad-999' };
    render(<RecordPublishForm artifact={approved} />);

    expect(screen.getByText(/Publish recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/ad-999/i)).toBeInTheDocument();
  });
});
