require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool, initializeDatabase } = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20kb' }));

function validateStudent(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const course = typeof body.course === 'string' ? body.course.trim() : '';
  const enrollmentDate = typeof body.enrollment_date === 'string' ? body.enrollment_date : '';
  if (!name || name.length > 120) return 'Name is required (maximum 120 characters).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return 'Enter a valid email address.';
  if (!course || course.length > 120) return 'Course is required (maximum 120 characters).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(enrollmentDate) || Number.isNaN(Date.parse(`${enrollmentDate}T00:00:00Z`))) return 'Enrollment date must be a valid YYYY-MM-DD date.';
  return { name, email, course, enrollmentDate };
}

app.get('/api/health', async (_req, res, next) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch (err) { next(err); }
});

app.get('/api/students', async (_req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, name, email, course, DATE_FORMAT(enrollment_date, \'%Y-%m-%d\') AS enrollment_date FROM students ORDER BY id DESC');
    res.json(rows);
  } catch (err) { next(err); }
});

app.post('/api/students', async (req, res, next) => {
  const student = validateStudent(req.body);
  if (typeof student === 'string') return res.status(400).json({ error: student });
  try {
    const [result] = await pool.execute('INSERT INTO students (name, email, course, enrollment_date) VALUES (?, ?, ?, ?)', [student.name, student.email, student.course, student.enrollmentDate]);
    res.status(201).json({ id: result.insertId, name: student.name, email: student.email, course: student.course, enrollment_date: student.enrollmentDate });
  } catch (err) { if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A student with this email already exists.' }); next(err); }
});

app.put('/api/students/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid student ID.' });
  const student = validateStudent(req.body);
  if (typeof student === 'string') return res.status(400).json({ error: student });
  try {
    const [result] = await pool.execute('UPDATE students SET name = ?, email = ?, course = ?, enrollment_date = ? WHERE id = ?', [student.name, student.email, student.course, student.enrollmentDate, id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Student not found.' });
    res.json({ id, name: student.name, email: student.email, course: student.course, enrollment_date: student.enrollmentDate });
  } catch (err) { if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A student with this email already exists.' }); next(err); }
});

app.delete('/api/students/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid student ID.' });
  try {
    const [result] = await pool.execute('DELETE FROM students WHERE id = ?', [id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Student not found.' });
    res.status(204).end();
  } catch (err) { next(err); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

const port = Number(process.env.PORT || 3000);
initializeDatabase().then(() => app.listen(port, '0.0.0.0', () => console.log(`Student API listening on port ${port}`))).catch((err) => {
  console.error('Could not initialize the database:', err.message);
  process.exit(1);
});
