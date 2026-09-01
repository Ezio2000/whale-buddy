import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactsPage } from '../../src/renderer/components/ArtifactsPage';
import type { WhaleApi } from '../../src/shared/types';

const originalWhale = window.whale;
const open = vi.fn().mockResolvedValue(undefined);
const saveAs = vi.fn().mockResolvedValue('/exports/report.docx');

beforeEach(() => {
  open.mockClear(); saveAs.mockClear();
  Object.defineProperty(window, 'whale', { configurable: true, value: {
    artifacts: {
      list: vi.fn().mockResolvedValue([{
        id: 'artifact-1', name: '季度报告.docx', path: '/whale/artifacts/report.docx', format: 'docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 2048,
        sha256: 'a'.repeat(64), threadId: 'thread-1', taskId: 'task-1', createdAt: 1,
      }]),
      open, saveAs, create: vi.fn(),
    },
  } as unknown as WhaleApi });
});

afterEach(() => Object.defineProperty(window, 'whale', { configurable: true, value: originalWhale }));

describe('ArtifactsPage', () => {
  it('lists permanent office artifacts and exposes open and save-as actions', async () => {
    render(<ArtifactsPage />);
    expect(await screen.findByText('季度报告.docx')).toBeInTheDocument();
    expect(screen.getByText(/2.0 KB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开 季度报告.docx' }));
    fireEvent.click(screen.getByRole('button', { name: '另存为 季度报告.docx' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('artifact-1'));
    expect(saveAs).toHaveBeenCalledWith('artifact-1');
  });
});
