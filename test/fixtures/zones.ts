/**
 * Zone frames shaped like the real thing. The classical entry carries
 * `artist_image_keys` exactly as RoonServer's own trace showed it
 * (evidence-archive/roon-arc-corrupt-media-20260803/roon-20260803-log04.txt):
 * an array of 1-4 keys sitting next to image_key, undocumented by RoonLabs.
 */
export const ZONES: unknown[] = [
  {
    zone_id: '1601abc', display_name: 'Study', state: 'playing',
    outputs: [{ output_id: '1701a', display_name: 'Study' }, { output_id: '1701b', display_name: 'Kitchen' }],
    is_play_allowed: false, is_pause_allowed: true, is_next_allowed: true,
    is_previous_allowed: true, is_seek_allowed: true,
    now_playing: {
      seek_position: 512, length: 1834, image_key: '1777dafbf8282dfacc794fff03d05a36',
      artist_image_keys: ['43f123b4d4ad8f5d62794f8f68b847c1', '5ee4e23b7696187a720ec3ed5f8b3860'],
      three_line: {
        line1: 'Piano Concerto No. 2 in C Minor, Op. 18: I. Moderato',
        line2: 'London Symphony Orchestra / André Previn / Sergei Rachmaninoff',
        line3: 'Rachmaninov: The Piano Concertos',
      },
    },
  },
  {
    zone_id: '1602def', display_name: 'Kitchen', state: 'paused',
    outputs: [{ output_id: '1702a', display_name: 'Kitchen' }],
    is_play_allowed: true, is_pause_allowed: false, is_next_allowed: true,
    is_previous_allowed: true, is_seek_allowed: true,
    now_playing: {
      seek_position: 64, length: 352, image_key: 'aa11bb22cc33',
      three_line: { line1: 'So What', line2: 'Miles Davis', line3: 'Kind of Blue' },
    },
  },
  {
    // Internet radio: a cover but NO artist keys — 7/7 of the no-key cases on the wire.
    zone_id: '1603ghi', display_name: 'Garden', state: 'playing',
    outputs: [{ output_id: '1703a', display_name: 'Garden' }],
    is_play_allowed: false, is_pause_allowed: true, is_next_allowed: false,
    is_previous_allowed: false, is_seek_allowed: false,
    now_playing: {
      seek_position: 12, image_key: 'dd44ee55ff66',
      three_line: { line1: 'Café Rhythmic Caress', line2: 'Cozy Coffee Shop', line3: '' },
    },
  },
  { zone_id: '1604jkl', display_name: 'Terrace', state: 'stopped', outputs: [{ output_id: '1704a', display_name: 'Terrace' }] },
];
