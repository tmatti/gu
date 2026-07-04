import { tool } from 'ai';
import { z } from 'zod';

const schema = z.object({
	url: z.string().describe('The URL of the page to read, typically taken from a webSearch result.'),
});

const MAX_CHARS = 5000;

export function htmlToText(html: string): string {
	return html
		.replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, '\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&#0?39;|&apos;/gi, "'")
		.replace(/&quot;/gi, '"')
		.replace(/[ \t]+/g, ' ')
		.replace(/\s*\n\s*/g, '\n')
		.trim();
}

export function readPage() {
	return tool({
		description:
			'Fetch a web page and return its text content. Use after webSearch to read full articles — search snippets alone are not enough for breakdowns or analysis.',
		inputSchema: schema,
		execute: async (input) => {
			try {
				const res = await fetch(input.url, {
					headers: {
						'User-Agent': 'Mozilla/5.0 (compatible; gu-bot/1.0)',
						Accept: 'text/html,application/xhtml+xml,text/plain',
					},
					signal: AbortSignal.timeout(10_000),
				});
				if (!res.ok) {
					return { error: `Failed to fetch page: ${res.status}` };
				}
				const contentType = res.headers.get('content-type') ?? '';
				if (!contentType.includes('html') && !contentType.includes('text')) {
					return { error: `Unsupported content type: ${contentType}` };
				}
				const html = await res.text();
				const text = htmlToText(html);
				return {
					url: input.url,
					truncated: text.length > MAX_CHARS,
					content: text.slice(0, MAX_CHARS),
				};
			} catch (err) {
				return { error: `Failed to read page: ${err instanceof Error ? err.message : String(err)}` };
			}
		},
	});
}
