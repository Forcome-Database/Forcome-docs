import {
  isPlanningEnabled,
  parseCreatorHistory,
  shouldEnterOutlinePhase,
} from './creator-generate.utils';

describe('creator-generate utils', () => {
  it('parses and trims recent history messages', () => {
    const history = parseCreatorHistory(JSON.stringify([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'tool', content: 'ignore me' },
      { role: 'user', content: '   ' },
    ]));

    expect(history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ]);
  });

  it('treats planning as opt-in', () => {
    expect(isPlanningEnabled()).toBe(false);
    expect(isPlanningEnabled('false')).toBe(false);
    expect(isPlanningEnabled('true')).toBe(true);
  });

  it('enters outline phase only when planning is enabled and outline is absent', () => {
    expect(shouldEnterOutlinePhase(undefined, '')).toBe(false);
    expect(shouldEnterOutlinePhase('true', '')).toBe(true);
    expect(shouldEnterOutlinePhase('true', '## Intro')).toBe(false);
  });
});
