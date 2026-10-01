import { describe, expect, test } from 'bun:test';

import {
  ownerRulesFromApprovalState,
  planOwnersPost,
} from '../codeowner-posts.ts';

describe('ownerRulesFromApprovalState', () => {
  test('keeps code owner rules and drops every other rule type', () => {
    const body = {
      rules: [
        { rule_type: 'any_approver', section: null, approved: true },
        { rule_type: 'regular', name: 'Leads', approved: false },
        { rule_type: 'code_owner', section: 'Acme - #pod-acme', approved: false },
        { rule_type: 'code_owner', section: 'Docs', approved: true },
      ],
    };
    expect(ownerRulesFromApprovalState(body)).toEqual([
      { section: 'Acme - #pod-acme', approved: false },
      { section: 'Docs', approved: true },
    ]);
  });

  test('a body without rules yields none', () => {
    expect(ownerRulesFromApprovalState(null)).toEqual([]);
    expect(ownerRulesFromApprovalState({})).toEqual([]);
    expect(ownerRulesFromApprovalState({ rules: 'nope' })).toEqual([]);
  });

  test('a code owner rule with no section name is dropped', () => {
    expect(
      ownerRulesFromApprovalState({
        rules: [{ rule_type: 'code_owner', section: null, approved: false }],
      })
    ).toEqual([]);
  });
});

describe('planOwnersPost', () => {
  const none = { posted: {} };

  test('an unapproved section with a channel is a post', () => {
    expect(
      planOwnersPost([{ section: 'Acme - #pod-acme', approved: false }], none)
    ).toEqual({
      channels: [{ channel: 'pod-acme', sections: ['Acme - #pod-acme'] }],
      skipped: [],
    });
  });

  test('sections sharing a channel make one post', () => {
    const plan = planOwnersPost(
      [
        { section: 'Acme - #pod-acme', approved: false },
        { section: 'Acme Jobs - #pod-acme', approved: false },
        { section: 'Docs - #pod-docs', approved: false },
      ],
      none
    );
    expect(plan.channels).toEqual([
      { channel: 'pod-acme', sections: ['Acme - #pod-acme', 'Acme Jobs - #pod-acme'] },
      { channel: 'pod-docs', sections: ['Docs - #pod-docs'] },
    ]);
  });

  test('an approved section is skipped, and its channel still posts for the others', () => {
    const plan = planOwnersPost(
      [
        { section: 'Acme - #pod-acme', approved: true },
        { section: 'Acme Jobs - #pod-acme', approved: false },
      ],
      none
    );
    expect(plan.channels).toEqual([
      { channel: 'pod-acme', sections: ['Acme Jobs - #pod-acme'] },
    ]);
    expect(plan.skipped).toEqual([
      { section: 'Acme - #pod-acme', reason: 'approved', channel: 'pod-acme' },
    ]);
  });

  test('a section is approved only when every one of its rules is', () => {
    const plan = planOwnersPost(
      [
        { section: 'Acme - #pod-acme', approved: true },
        { section: 'Acme - #pod-acme', approved: false },
      ],
      none
    );
    expect(plan.channels).toEqual([
      { channel: 'pod-acme', sections: ['Acme - #pod-acme'] },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  test('a section with no channel in its name is skipped', () => {
    expect(planOwnersPost([{ section: 'Docs', approved: false }], none)).toEqual({
      channels: [],
      skipped: [{ section: 'Docs', reason: 'no-channel' }],
    });
  });

  test('a channel already posted to is skipped with its link', () => {
    const plan = planOwnersPost(
      [{ section: 'Acme - #pod-acme', approved: false }],
      { posted: { 'pod-acme': 'https://team.slack.com/archives/C1/p1' } }
    );
    expect(plan).toEqual({
      channels: [],
      skipped: [
        {
          section: 'Acme - #pod-acme',
          reason: 'already-posted',
          channel: 'pod-acme',
          permalink: 'https://team.slack.com/archives/C1/p1',
        },
      ],
    });
  });

  test('a channel Slack does not list is skipped', () => {
    const plan = planOwnersPost(
      [
        { section: 'Acme - #pod-acme', approved: false },
        { section: 'Docs - #pod-docs', approved: false },
      ],
      { posted: {}, available: new Set(['pod-docs']) }
    );
    expect(plan.channels).toEqual([
      { channel: 'pod-docs', sections: ['Docs - #pod-docs'] },
    ]);
    expect(plan.skipped).toEqual([
      {
        section: 'Acme - #pod-acme',
        reason: 'channel-unavailable',
        channel: 'pod-acme',
      },
    ]);
  });
});
