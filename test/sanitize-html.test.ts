import { describe, expect, it } from 'vitest';
import { sanitizeEmailHtml } from '../src/security/sanitize-html';

describe('email HTML isolation', () => {
  it('removes scripts, active attributes, remote images, links and CSS', () => {
    const clean = sanitizeEmailHtml('<p onclick="alert(1)" style="background:url(https://track.test)">Hi</p><script>alert(2)</script><img src="https://track.test/pixel"><a href="https://track.test">click</a>');
    expect(clean).toContain('<p>Hi</p>');
    expect(clean).not.toMatch(/script|onclick|style|track\.test|href=/i);
  });
});
