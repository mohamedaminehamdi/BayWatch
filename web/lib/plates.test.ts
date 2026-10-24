import test from 'node:test';
import assert from 'node:assert/strict';
import { samePlate } from './plates.ts';

test('samePlate tolerates common camera misreads, and nothing more', () => {
  assert.equal(samePlate('m-ab 1234', 'MAB1234'), 'exact');
  assert.equal(samePlate('MA81234', 'MAB1234'), 'fuzzy', 'B read as 8');
  assert.equal(samePlate('M0 5123', 'MO S123'), 'fuzzy', 'O/0 and S/5');
  assert.equal(samePlate('MAB124', 'MAB1234'), 'fuzzy', 'one character dropped on a 6+ plate');
  assert.equal(samePlate('BXY987', 'MAB1234'), null);
  assert.equal(samePlate('AB13', 'AB12'), null, 'short plates must match exactly');
  assert.equal(samePlate('MAB1', 'MAB1234'), null);
  assert.equal(samePlate('', 'MAB1234'), null);
  assert.equal(samePlate('MAB1234', null), null);
});
