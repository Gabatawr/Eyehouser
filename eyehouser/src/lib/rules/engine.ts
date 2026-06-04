import { CaptureRule, matchRule } from './matchers';

export class RuleEngine {
  constructor(private rules: CaptureRule[]) {}

  match(request: any): CaptureRule | null {
    for (const rule of this.rules) {
      if (matchRule(rule, request)) return rule;
    }
    return null;
  }

  updateRules(rules: CaptureRule[]) { this.rules = rules; }
}
