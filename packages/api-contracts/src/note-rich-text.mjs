const blocks = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'hardBreak', 'horizontalRule', 'text']);
const marks = new Set(['bold', 'italic', 'underline', 'strike']);
export function validNoteDocument(value) {
    let count = 0;
    function visit(node, depth) {
        if (!node || typeof node !== 'object' || depth > 16 || ++count > 6000)
            return false;
        const n = node;
        if (!Object.keys(n).every(key => ['type', 'text', 'attrs', 'marks', 'content'].includes(key)))
            return false;
        if (depth === 0 ? n.type !== 'doc' : !blocks.has(n.type))
            return false;
        if (n.text !== undefined && (n.type !== 'text' || typeof n.text !== 'string'))
            return false;
        if (n.type === 'text' && (typeof n.text !== 'string' || n.content !== undefined))
            return false;
        if (n.attrs !== undefined) {
            if (!n.attrs || typeof n.attrs !== 'object' || Array.isArray(n.attrs))
                return false;
            if (n.type === 'heading') {
                if (!Object.keys(n.attrs).every(key => key === 'level') || ![1, 2, 3].includes(n.attrs.level))
                    return false;
            }
            else if (n.type === 'orderedList') {
                if (!Object.keys(n.attrs).every(key => ['start','type'].includes(key)) || !Number.isInteger(n.attrs.start) || n.attrs.start < 1 || n.attrs.start > 10000 || (n.attrs.type != null && !['1','a','A','i','I'].includes(n.attrs.type)))
                    return false;
            }
            else
                return false;
        }
        if (n.marks !== undefined && (!Array.isArray(n.marks) || n.marks.length > 4 || !n.marks.every(mark => mark && typeof mark === 'object' && Object.keys(mark).length === 1 && marks.has(mark.type))))
            return false;
        if (n.content !== undefined && (!Array.isArray(n.content) || !n.content.every(child => visit(child, depth + 1))))
            return false;
        const children=n.content??[];
        if(['doc','blockquote','listItem'].includes(n.type)&&!children.every(child=>['paragraph','heading','bulletList','orderedList','blockquote','horizontalRule'].includes(child.type)))return false;
        if(['paragraph','heading'].includes(n.type)&&!children.every(child=>['text','hardBreak'].includes(child.type)))return false;
        if(['bulletList','orderedList'].includes(n.type)&&(!children.length||!children.every(child=>child.type==='listItem')))return false;
        if(n.type==='listItem'&&children[0]?.type!=='paragraph')return false;
        if(['hardBreak','horizontalRule'].includes(n.type)&&children.length)return false;
        if(n.marks?.length&&!['text','hardBreak'].includes(n.type))return false;
        return depth !== 0 || Array.isArray(n.content);
    }
    return visit(value, 0);
}
export function noteDocumentText(document) {
    function text(node) {
        if (node.type === 'text')
            return node.text ?? '';
        if (node.type === 'hardBreak')
            return '\n';
        if (node.type === 'horizontalRule')
            return '---';
        const children = node.content ?? [];
        return children.map(text).join(['doc', 'blockquote', 'bulletList', 'orderedList', 'listItem'].includes(node.type) ? '\n\n' : '');
    }
    return text(document);
}
export function plainNoteDocument(value) {
    return { type: 'doc', content: value.split('\n\n').map(paragraph => ({ type: 'paragraph', content: paragraph.split('\n').flatMap((line, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]) })) };
}
export function appendNoteDocument(existing, plain, addition) {
    return { type: 'doc', content: [...(plain ? (existing ?? plainNoteDocument(plain)).content : []), ...plainNoteDocument(addition).content] };
}
