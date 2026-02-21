function formatAISummary(text) {
    if (!text) return '';

    // 1. HTML-escape
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 2. Headings (line-start)
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

    // 3. Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // 4. Italic (text must not start/end with whitespace)
    html = html.replace(/\*(\S.*?\S|\S)\*/g, '<em>$1</em>');
    html = html.replace(/_(\S.*?\S|\S)_/g, '<em>$1</em>');

    // 5. Unordered list items
    html = html.replace(/^[\*\-•] (.+)$/gm, '<li>$1</li>');

    // 6. Ordered list items
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // 7. Wrap consecutive <li> in <ul>
    html = html.replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul>$1</ul>');

    // 8. Double newlines → paragraph breaks
    html = html.replace(/\n\n/g, '</p><p>');

    // 9. Single newlines → line breaks
    html = html.replace(/\n/g, '<br>');

    // 10. Wrap in <p> if needed
    if (!html.startsWith('<p>') && !html.startsWith('<h') && !html.startsWith('<ul>')) {
        html = '<p>' + html;
    }
    if (!html.endsWith('</p>') && !html.endsWith('</h2>') && !html.endsWith('</h3>') && !html.endsWith('</h4>') && !html.endsWith('</ul>')) {
        html = html + '</p>';
    }

    // 11. Clean up
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<h[234]>)/g, '$1');
    html = html.replace(/(<\/h[234]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');

    return html;
}
