import fs from 'fs';

const outputHeader = 'URL,Provider Name,Title,Practice Name,More Providers Count,Other Providers Details,Status\n';
const failedHeader = 'URL,Error,Timestamp\n';

fs.writeFileSync('output.csv', outputHeader, 'utf8');
fs.writeFileSync('failed.csv', failedHeader, 'utf8');

console.log('==================================================');
console.log('  Successfully reset output.csv and failed.csv!');
console.log('==================================================');
