import 'jasmine';

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as ts from 'typescript';

import {Checker} from '../../checker';
import {Failure, Fix} from '../../failure';
import {AbstractRule} from '../../rule';



/**
 * Turns the provided source (as strings) into a ts.Program. The source files
 * will be named `.../file_${n}.ts`, with n the index of the source file in
 * the `sourceCode` array.
 */
export function compile(...sourceCode: string[]): ts.Program {
  const temporaryFolder = os.tmpdir() +
      `/tslint_test_input_${crypto.randomBytes(16).toString('hex')}`;
  const fullPaths: string[] = [];
  sourceCode.forEach((s, i) => {
    fullPaths.push(`${temporaryFolder}/file_${i}.ts`);
  });

  let error: Error|undefined = undefined;
  let program: ts.Program|undefined = undefined;
  try {  // Wrap it all in a try/finally to clean up the temp files afterwards
    fs.mkdirSync(temporaryFolder);
    sourceCode.forEach((s, i) => {
      fs.writeFileSync(fullPaths[i], s);
    });
    program = ts.createProgram(fullPaths, {});
    if (ts.getPreEmitDiagnostics(program).length !== 0) {
      throw new Error(
          'Your program does not compile cleanly. Diagnostics:\n' +
          ts.formatDiagnostics(
              ts.getPreEmitDiagnostics(program), ts.createCompilerHost({})));
    }
  } catch (e) {
    error = e;
  } finally {
    fullPaths.forEach(p => fs.unlinkSync(p));
    fs.rmdirSync(temporaryFolder);
  }
  if (program && !error) {
    return program;
  } else {
    throw error;
  }
}

function check(rule: AbstractRule, program: ts.Program): Failure[] {
  const checker = new Checker(program);
  rule.register(checker);
  return program.getSourceFiles()
      .map(s => checker.execute(s))
      .reduce((prev, cur) => prev.concat(cur));
}

/** Builds and run the given Rule upon the source files that were provided. */
export function compileAndCheck(
    rule: AbstractRule, ...sourceCode: string[]): Failure[] {
  const program = compile(...sourceCode);
  return check(rule, program);
}

// Custom matcher for Jasmine, for a better experience matching fixes.
export const customMatchers: jasmine.CustomMatcherFactories = {
  toBeFailureMatching(): jasmine.CustomMatcher {
    return {
      compare: (actual: ts.Diagnostic&{end: number, fix?: Fix}, exp: {
        fileName?: string, start: number, end: number,
      }) => {
        let regrets = '';
        if (exp === undefined) {
          regrets += 'The rule requires two arguments. ';
        }
        if (exp.fileName) {
          if (!actual.file) {
            regrets += 'Expected diagnostic to have a source file. ';
          } else if (!actual.file.fileName.endsWith(exp.fileName)) {
            regrets += `Expected ${actual.file.fileName} to end with ${
                exp.fileName}. `;
          }
        }
        if (exp.start && actual.start !== exp.start) {
          regrets += expectation('start', exp.start, actual.start);
        }
        if (exp.end && actual.end !== exp.end) {
          regrets += expectation('end', exp.end, actual.end);
        }
        return {pass: regrets === '', message: regrets};
      }
    };
  }
};

function expectation(fieldname: string, expectation: any, actual: any) {
  return `Expected .${fieldname} to be ${expectation}, was ${actual}. `;
}

// And the matching type
declare global {
  namespace jasmine {
    interface Matchers<T> {
      toBeFailureMatching(expected: {
        fileName?: string,
                start: number,
                end: number,
                [i: string]: any  // the rest
      }): void;
    }
  }
}
