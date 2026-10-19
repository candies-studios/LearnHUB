'use strict';
// Builds the native "Chiller Lock-out Safety Certification" course on top of the imported
// "Chiller SOP and Lockout Process" SCORM package (reuses its two videos).
const { db, save, newId } = require('./db');

const SCORM_TITLE = 'Chiller SOP and Lockout Process';

const Q = [
  ['single', 'What is the primary purpose of a lock-out in an air-cooled chiller?', ['To increase cooling capacity', 'To prevent equipment damage and ensure safety', 'To reduce noise levels', 'To improve airflow efficiency'], [1], 'Lock-out prevents equipment damage and ensures safety during faults — it is not a performance feature.'],
  ['single', 'Which of the following conditions is most likely to trigger a lock-out?', ['High discharge pressure', 'Low ambient temperature', 'Normal operating load', 'Balanced refrigerant levels'], [0], 'High discharge pressure is a common fault condition that triggers lock-out. Normal operation does not.'],
  ['single', 'What is the first step a technician should take after a chiller enters lock-out mode?', ['Immediately reset the system', 'Check diagnostic codes and alarms', 'Increase the refrigerant charge', "Shut down the building's power supply"], [1], 'Never reset immediately — check the diagnostic codes and alarms first.'],
  ['tf', 'A lock-out requires a manual or system reset, while a shutdown may restart automatically.', null, 'true', 'Lock-out is more restrictive than a shutdown and needs intervention before the unit restarts.'],
  ['single', 'Which safety measure is essential before troubleshooting a locked-out chiller?', ['Wearing PPE such as gloves and goggles', 'Increasing the setpoint temperature', "Disconnecting the building's water supply", 'Running the chiller at partial load'], [0], 'Safety comes first — always wear the correct PPE.'],
  ['single', 'Why is documentation of lock-out incidents important?', ['To calculate energy efficiency', 'To reduce refrigerant usage', 'To improve airflow distribution', 'To comply with safety regulations and track recurring issues'], [3], 'Records keep you compliant and reveal recurring faults.'],
  ['tf', 'Disabling the lock-out function is an acceptable long-term fix when a chiller repeatedly trips during peak load.', null, 'false', 'Never bypass safety systems — find and fix the root cause.'],
  ['single', 'What is the primary function of an air-cooled chiller in HVAC systems?', ['To heat water for building use', 'To remove heat from water and reject it to the air', 'To increase indoor humidity', 'To store refrigerant for backup'], [1], 'A chiller removes heat from water and rejects it to the air.'],
  ['single', 'Which component in an air-cooled chiller is responsible for rejecting heat to the atmosphere?', ['Evaporator', 'Compressor', 'Condenser coil with fans', 'Expansion valve'], [2], 'Heat rejection happens in the condenser coil, helped by the fans.'],
  ['tf', 'Air-cooled chillers cool water or a glycol solution circulated through a cooling loop.', null, 'true', 'Water or glycol is circulated through the loop and cooled.'],
  ['single', 'Why are air-cooled chillers often preferred over water-cooled chillers in certain installations?', ['They require less maintenance and no cooling tower', 'They provide higher efficiency in all climates', 'They use less refrigerant', 'They operate silently'], [0], 'Air-cooled chillers are simpler: no cooling tower and less maintenance.'],
  ['single', 'Which operational parameter must be closely monitored to prevent chiller inefficiency or lock-out?', ['Ambient noise levels', 'Building occupancy', 'Lighting load', 'Condenser air temperature and airflow'], [3], 'Condenser air temperature and airflow directly affect performance and trips.'],
  ['tf', 'The expansion valve in a chiller is responsible for compressing refrigerant vapor.', null, 'false', 'The expansion valve meters refrigerant into the evaporator; the compressor does the compressing.'],
  ['single', 'During peak load operation, what preventive measure ensures stable chiller performance?', ['Reducing fan speed', 'Cleaning condenser coils regularly', 'Increasing refrigerant charge beyond design', 'Disabling safety controls'], [1], 'Clean condenser coils keep heat transfer efficient.'],
  ['single', 'What is the typical consequence of dirty condenser coils in an air-cooled chiller?', ['Reduced water flow', 'Lower refrigerant charge', 'Increased discharge pressure and reduced efficiency', 'Faster compressor cycling'], [2], 'Dirty coils raise discharge pressure and cut efficiency — a common lock-out cause.'],
];

function createChillerCertification(scorm) {
  if (!scorm || scorm.type !== 'scorm' || scorm.title !== SCORM_TITLE) return null;
  if (db.courses.some((c) => c.code === 'HVAC-CERT-01')) return null;
  const now = new Date().toISOString();
  if (!scorm.code) scorm.code = 'HVAC-SC-01';
  if (!scorm.category || scorm.category === 'General') scorm.category = 'HVAC & Facilities';
  const media = (f) => `/content/scorm/${scorm.scorm.dir.replace(/\/$/, '')}/video/${f}`;
  {
  const exam = {
    id: newId('exm'), title: 'Chiller Lock-out Certification Exam',
    instructions: '15 questions on air-cooled chiller operation and lock-out safety. You need **80%** to pass and have **20 minutes**. You get 3 attempts.',
    passPct: 80, timeLimitMins: 20, maxAttempts: 3, drawCount: 0, shuffleQuestions: true, shuffleOptions: true, reviewAnswers: 'after_pass', createdAt: now,
    questions: Q.map(([type, text, opts, correct, explanation]) => ({
      id: newId('q'), type, text, explanation, points: 1,
      options: type === 'tf'
        ? [{ id: newId('opt'), text: 'True', correct: correct === 'true' }, { id: newId('opt'), text: 'False', correct: correct === 'false' }]
        : opts.map((t, i) => ({ id: newId('opt'), text: t, correct: correct.includes(i) })),
    })),
  };
  db.exams.push(exam);
  const native = {
    id: newId('crs'), type: 'native', code: 'HVAC-CERT-01', title: 'Chiller Lock-out Safety Certification',
    description: 'Watch the Chiller SOP and Lockout Process videos, review the key safety points, then pass a timed 15-question exam to earn a 12-month certificate.',
    category: 'HVAC & Facilities', color: '#0a6ed1', status: 'published', durationMins: 60, selfEnroll: true, sequential: true,
    certificate: { enabled: true, validityMonths: 12 }, createdAt: now,
    modules: [
      { id: newId('mod'), type: 'video', title: 'Chiller SOP', url: media('chiller_sop.mp4'), preventSkip: true },
      { id: newId('mod'), type: 'video', title: 'Lockout Process', url: media('m1_c1.mp4'), preventSkip: true },
      { id: newId('mod'), type: 'text', title: 'Key safety points', body: [
        '# What an air-cooled chiller does',
        'An air-cooled chiller **removes heat from water (or a glycol solution)** circulated through a cooling loop and **rejects that heat to the outside air** through the **condenser coil and fans**.',
        '- The **compressor** compresses refrigerant vapour.',
        '- The **expansion valve** meters refrigerant into the evaporator — it does not compress anything.',
        '- Air-cooled units need **no cooling tower** and less maintenance than water-cooled units.',
        '',
        '# Lock-out vs shutdown',
        'A **lock-out** protects people and equipment when the chiller detects a fault. Unlike a normal shutdown, which may restart automatically, a lock-out **needs a manual or system reset**.',
        '- Common trigger: **high discharge pressure**.',
        '- Dirty condenser coils raise discharge pressure and reduce efficiency — a frequent root cause.',
        '- Keep an eye on **condenser air temperature and airflow**.',
        '',
        '# When a chiller locks out',
        '1. **Do not reset immediately.** Read the diagnostic codes and alarms first.',
        '2. Wear the correct **PPE** (gloves, goggles) before troubleshooting.',
        '3. Find and fix the **root cause**. Never disable or bypass the lock-out, even if it trips repeatedly at peak load.',
        '4. **Document the incident** — it keeps you compliant and shows up recurring faults.',
        '',
        '# Prevention',
        '- Clean condenser coils regularly, especially before peak season.',
        '- Never overcharge refrigerant beyond design or run with safety controls disabled.',
      ].join('\n') },
      { id: newId('mod'), type: 'exam', title: 'Certification exam', examId: exam.id },
    ],
  };
  db.courses.push(native);
  save();
  return native;
  }

}

module.exports = { createChillerCertification, SCORM_TITLE };
