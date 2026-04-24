/**
 * Runs afterEach for every integration test. Tests own their harness
 * lifecycle and call harness.reset() themselves — this hook is a safety
 * net for suites that forget.
 */
import { clearFaults } from './helpers/fault-injection';

afterEach(() => { clearFaults(); });
