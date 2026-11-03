import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { copyText } from './clipboard';

const KEY_ID = '8a1f4e2b-7bc6-4f1d-9e0a-1d2c9b3a7f8e';

type Field = { value: string; style: Record<string, string>; setAttribute: Mock; select: Mock; remove: Mock };

describe('copyText', () => {
  let writeText: Mock;
  let execCommand: Mock;
  let field: Field;

  beforeEach(() => {
    writeText = vi.fn();
    execCommand = vi.fn();
    field = { value: '', style: {}, setAttribute: vi.fn(), select: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', {
      createElement: () => field,
      body: { appendChild: vi.fn() },
      execCommand
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('copies through the Clipboard API', async () => {
    // given
    writeText.mockResolvedValue(undefined);

    // when
    const copied = await copyText(KEY_ID);

    // then
    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledWith(KEY_ID);
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to a selection copy when the frame blocks the Clipboard API', async () => {
    // given
    writeText.mockRejectedValue(new DOMException('blocked by permissions policy', 'NotAllowedError'));
    execCommand.mockReturnValue(true);

    // when
    const copied = await copyText(KEY_ID);

    // then
    expect(copied).toBe(true);
    expect(field.value).toBe(KEY_ID);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(field.remove).toHaveBeenCalled();
  });

  it('reports a failure when neither way copies', async () => {
    // given
    writeText.mockRejectedValue(new DOMException('blocked by permissions policy', 'NotAllowedError'));
    execCommand.mockReturnValue(false);

    // when
    const copied = await copyText(KEY_ID);

    // then
    expect(copied).toBe(false);
    expect(field.remove).toHaveBeenCalled();
  });
});
