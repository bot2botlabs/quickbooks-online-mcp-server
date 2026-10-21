import { formatError, formatQuickBooksFaultMessage } from '../../../src/helpers/format-error';

describe('formatError', () => {
  it('should format Error instances', () => {
    const error = new Error('Something went wrong');
    expect(formatError(error)).toBe('Error: Something went wrong');
  });

  it('should format string errors', () => {
    expect(formatError('A string error')).toBe('Error: A string error');
  });

  it('should format unknown error types', () => {
    const unknownError = { code: 500, message: 'Server error' };
    expect(formatError(unknownError)).toBe(
      'Unknown error: {"code":500,"message":"Server error"}'
    );
  });

  it('should handle null errors', () => {
    expect(formatError(null)).toBe('Unknown error: null');
  });

  it('should handle undefined errors', () => {
    expect(formatError(undefined)).toBe('Unknown error: undefined');
  });

  it('should handle number errors', () => {
    expect(formatError(404)).toBe('Unknown error: 404');
  });

  it('should surface QuickBooks Fault details from axios errors', () => {
    const err = Object.assign(new Error('Request failed with status code 400'), {
      response: {
        data: {
          Fault: {
            Error: [
              {
                Message: 'Invalid Reference Id',
                Detail: 'Invalid Reference Id : ClassRef',
                code: '2500',
                element: 'ClassRef',
              },
            ],
          },
        },
      },
    });

    expect(formatError(err)).toBe(
      'Error: Invalid Reference Id — Invalid Reference Id : ClassRef — code=2500 — element=ClassRef'
    );
  });

  it('falls back to the axios message when response data has no Fault', () => {
    const err = Object.assign(new Error('Request failed with status code 400'), {
      response: { data: { message: 'not a fault' } },
    });

    expect(formatError(err)).toBe('Error: Request failed with status code 400');
  });

  it('should surface QuickBooks Fault when the error object is the fault payload', () => {
    const faultBody = {
      Fault: {
        Error: [{ Message: 'Object Not Found', Detail: 'Something was not found', code: '610' }],
      },
    };

    expect(formatError(faultBody)).toBe('Error: Object Not Found — Something was not found — code=610');
  });

  it('does not duplicate Detail when it matches Message', () => {
    const err = {
      Fault: { Error: [{ Message: 'Duplicate', Detail: 'Duplicate', code: '1' }] },
    };
    expect(formatError(err)).toBe('Error: Duplicate — code=1');
  });
});

describe('formatQuickBooksFaultMessage', () => {
  it('returns null when no fault is present', () => {
    expect(formatQuickBooksFaultMessage({})).toBeNull();
    expect(formatQuickBooksFaultMessage(null)).toBeNull();
  });

  it('returns null when fault entries have no displayable fields', () => {
    expect(formatQuickBooksFaultMessage({ Fault: { Error: [{}] } })).toBeNull();
  });
});
