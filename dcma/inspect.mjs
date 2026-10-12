import { MySQLLite } from './mysql-lite.js';
const db = new MySQLLite({host:'10.108.12.164',user:'root',password:'707707'}); await db.connect();
for (const t of ['real_data','real_data_01','real_data_02','real_data_03','real_data_04']) {
 console.log('\nTABLE',t); console.log((await db.query(`DESCRIBE dcma.${t}`)).rows); console.log('SAMPLE', (await db.query(`SELECT * FROM dcma.${t} LIMIT 2`)).rows);
}
db.close();
