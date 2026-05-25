// ============================================================
// ApprovalForm Component Tests — PR #36
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalForm } from './ApprovalForm.jsx';
import { DECISION } from '../../types/feedbackTypes.js';

describe('ApprovalForm Component — PR #36', () => {
  const mockArtifact = {
    id: 'artifact-1',
    type: 'ad_copy',
    content: 'Test content',
  };

  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all decision buttons', () => {
    render(
      <ApprovalForm
        artifact={mockArtifact}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText(/Approve/i)).toBeInTheDocument();
    expect(screen.getByText(/Regenerate/i)).toBeInTheDocument();
    expect(screen.getByText(/Request Revision/i)).toBeInTheDocument();
    expect(screen.getByText(/Reject/i)).toBeInTheDocument();
    expect(screen.getByText(/Escalate/i)).toBeInTheDocument();
  });

  it('should select decision on button click', () => {
    render(
      <ApprovalForm
        artifact={mockArtifact}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    const approveButton = screen.getByText(/Approve/i).closest('button');
    fireEvent.click(approveButton);

    // Button should be highlighted (has ring classes)
    expect(approveButton).toHaveClass('ring-2');
  });

  it('should show structured feedback form for REGENERATE', () => {
    render(
      <ApprovalForm
        artifact={mockArtifact}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    // Structured feedback should not be visible initially
    expect(screen.queryByText(/Structured Feedback/i)).not.toBeInTheDocument();

    // Click Regenerate
    const regenerateButton = screen.getByText(/Regenerate/i).closest('button');
    fireEvent.click(regenerateButton);

    // Structured feedback should now be visible
    expect(screen.getByText(/Structured Feedback/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Feedback Type/i)).toBeInTheDocument();
    expect(screen.getByText(/Severity/i)).toBeInTheDocument();
    expect(screen.getByText(/Preserve \(do not change\)/i)).toBeInTheDocument();
  });

  it('should show structured feedback form for REQUEST_REVISION', () => {
    render(
      <ApprovalForm
        artifact={mockArtifact}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    const revisionButton = screen.getByText(/Request Revision/i).closest('button');
    fireEvent.click(revisionButton);

    expect(screen.getByText(/Structured Feedback/i)).toBeInTheDocument();
  });

  it('should not show structured feedback for APPROVE', () => {
    render(
      <ApprovalForm
        artifact={mockArtifact}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    const approveButton = screen.getByText(/Approve/i).closest('button');
    fireEvent.click(approveButton);

    expect(screen.queryByText(/Structured Feedback/i)).not.toBeInTheDocument();
  });

  it('should handle free-form feedback input', () => {
    render(
      <ApprovalForm
        artifact={mockArtifact}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    const feedbackTextarea = screen.getByPlaceholderText(/Explain your decision/i);
    fireEvent.change(feedbackTextarea, { target: { value: 'This needs improvement' } });

    expect(feedbackTextarea.value).toBe('This needs improvement');
  });

  it('should submit decision with feedback', () => {
    render(
      <ApprovalForm
        artifact={mockArtifact}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    // Select decision
    const approveButton = screen.getByText(/Approve/i).closest('button');
    fireEvent.click(approveButton);

    // Add feedback
    const feedbackTextarea = screen.getByPlaceholderText(/Explain your decision/i);
    fireEvent.change(feedbackTextarea, { target: { value: 'Looks good!' } });

    // Submit
    const submitButton = screen.getByText(/Submit Decision/i);
    fireEvent.click(submitButton);

    expect(mockOnSubmit).toHaveBeenCalledWith({
      decision: DECISION.APPROVED,
      feedback: 'Looks good!',
    });
  });

  it('should submit with structured feedback for REGENERATE', () => {
    render(
      <ApprovalForm
        artifact={mockArtifact}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    // Select Regenerate
    const regenerateButton = screen.getByText(/Regenerate/i).closest('button');
    fireEvent.click(regenerateButton);

    // Select feedback type
    const feedbackTypeSelect = screen.getByLabelText(/Feedback Type/i);
    fireEvent.change(feedbackTypeSelect, { target: { value: 'hook_angle' } });

    // Select severity (HIGH radio)
    const highSeverityRadio = screen.getByLabelText(/HIGH/i);
    fireEvent.click(highSeverityRadio);

    // Select preserve aspects
    const brandVoiceCheckbox = screen.getByLabelText(/Brand Voice/i);
    fireEvent.click(brandVoiceCheckbox);

    // Submit
    const submitButton = screen.getByText(/Submit Decision/i);
    fireEvent.click(submitButton);

    expect(mockOnSubmit).toHaveBeenCalledWith({
      decision: DECISION.REGENERATE,
      feedback: null,
      decisionMetadata: {
        feedbackType: 'hook_angle',
        severity: 'HIGH',
        preserveAspects: ['brand_voice'],
      },
    });
  });

  it('should call onCancel when cancel button clicked', () => {
    render(
      <ApprovalForm
        artifact={mockArtifact}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    const cancelButton = screen.getByText(/Cancel/i);
    fireEvent.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('should prevent submission without decision selected', () => {
    render(
      <ApprovalForm
        artifact={mockArtifact}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    const submitButton = screen.getByText(/Submit Decision/i);

    // Button should be disabled when no decision is selected
    expect(submitButton).toBeDisabled();

    // Clicking disabled button should not call onSubmit
    fireEvent.click(submitButton);
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('should pre-fill form with initial decision', () => {
    const initialDecision = {
      decision: DECISION.REGENERATE,
      feedback: 'Try different angle',
      decisionMetadata: {
        feedbackType: 'hook_angle',
        severity: 'MEDIUM',
        preserveAspects: ['brand_voice', 'cta'],
      },
    };

    render(
      <ApprovalForm
        artifact={mockArtifact}
        onSubmit={mockOnSubmit}
        initialDecision={initialDecision}
      />
    );

    // Decision should be selected
    const regenerateButton = screen.getByText(/Regenerate/i).closest('button');
    expect(regenerateButton).toHaveClass('ring-2');

    // Feedback should be filled
    const feedbackTextarea = screen.getByPlaceholderText(/Add additional context/i);
    expect(feedbackTextarea.value).toBe('Try different angle');

    // Structured feedback should be filled
    const feedbackTypeSelect = screen.getByLabelText(/Feedback Type/i);
    expect(feedbackTypeSelect.value).toBe('hook_angle');

    const mediumSeverityRadio = screen.getByLabelText(/MEDIUM/i);
    expect(mediumSeverityRadio).toBeChecked();

    const brandVoiceCheckbox = screen.getByLabelText(/Brand Voice/i);
    const ctaCheckbox = screen.getByLabelText(/Call to Action/i);
    expect(brandVoiceCheckbox).toBeChecked();
    expect(ctaCheckbox).toBeChecked();
  });
});
