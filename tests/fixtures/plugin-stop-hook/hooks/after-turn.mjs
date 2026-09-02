let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  JSON.parse(input || '{}');
  process.stdout.write(JSON.stringify({ continue: true }));
});
