## Summary

Describe the behavior changed and why.

## Validation

- [ ] `./scripts/validate_repo.sh`
- [ ] Non-streaming WAV smoke test, when relevant
- [ ] HTTP PCM streaming test, when relevant
- [ ] WebSocket model-input streaming test, when relevant
- [ ] Before/after TTFP, RTF, audio-s/s and req/s, for performance changes

## Safety

- [ ] No model weights, credentials, private audio, logs, PID files or machine-specific paths
- [ ] Experimental behavior remains disabled by default unless repeated data supports promotion
