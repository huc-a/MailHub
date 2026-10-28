import sanitizeHtml from 'sanitize-html';

const allowedTags = ['p','br','div','span','strong','b','em','i','u','s','blockquote','pre','code','ul','ol','li','table','thead','tbody','tr','td','th','h1','h2','h3','h4','hr'];
export function sanitizeEmailHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags,
    allowedAttributes: { '*': ['dir','lang'], td: ['colspan','rowspan'], th: ['colspan','rowspan'] },
    allowedSchemes: [], allowProtocolRelative: false,
    disallowedTagsMode: 'discard', parseStyleAttributes: false,
  });
}
