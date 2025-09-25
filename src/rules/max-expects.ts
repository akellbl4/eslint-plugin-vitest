import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createEslintRule, FunctionExpression } from '../utils'
import {
  isTypeOfVitestFnCall,
  parseVitestFnCall,
} from '../utils/parse-vitest-fn-call'

export const RULE_NAME = 'max-expects'
export type MESSAGE_ID = 'maxExpect'
export type Options = [
  {
    max: number
  },
]

export default createEslintRule<Options, MESSAGE_ID>({
  name: RULE_NAME,
  meta: {
    docs: {
      requiresTypeChecking: false,
      recommended: false,
      description: 'enforce a maximum number of expect per test',
    },
    messages: {
      maxExpect:
        'Too many assertion calls ({{ count }}) - maximum allowed is {{ max }}',
    },
    type: 'suggestion',
    schema: [
      {
        type: 'object',
        properties: {
          max: {
            type: 'number',
          },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{ max: 5 }],
  create(context, [{ max }]) {
    const expectCountsByFunction = new WeakMap<TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression, number>()
    let currentFunction: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression | null = null

    return {
      'FunctionExpression, ArrowFunctionExpression'(node: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression) {
        // Check if this function is a test function
        let isFunctionTest = 
          node.parent?.type === AST_NODE_TYPES.CallExpression &&
          isTypeOfVitestFnCall(node.parent, context, ['test'])

        // Additional check for extended test functions like `const it = base.extend({})`
        if (!isFunctionTest && node.parent?.type === AST_NODE_TYPES.CallExpression) {
          const callExpr = node.parent
          if (callExpr.callee.type === AST_NODE_TYPES.Identifier) {
            // Check if the callee identifier resolves to a test context variable
            const parsedCall = parseVitestFnCall(callExpr, context)
            isFunctionTest = parsedCall?.type === 'test'
            
            // If parseVitestFnCall didn't recognize it, check manually for common test function names
            if (!isFunctionTest) {
              const calleeString = callExpr.callee.name
              if (calleeString === 'it' || calleeString === 'test') {
                // This might be an extended test function - assume it is for now
                // We can make this more sophisticated later if needed
                isFunctionTest = true
              }
            }
          }
        }

        if (isFunctionTest) {
          expectCountsByFunction.set(node, 0)
          currentFunction = node
        }
      },
      'FunctionExpression, ArrowFunctionExpression:exit'(node: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression) {
        if (expectCountsByFunction.has(node)) {
          currentFunction = null
        }
      },
      CallExpression(node) {
        const vitestFnCall = parseVitestFnCall(node, context)

        if (
          vitestFnCall?.type !== 'expect' ||
          vitestFnCall.head.node.parent?.type ===
            AST_NODE_TYPES.MemberExpression
        )
          return

        // Only count expects that are inside test functions we're tracking
        if (currentFunction && expectCountsByFunction.has(currentFunction)) {
          const currentCount = expectCountsByFunction.get(currentFunction)! + 1
          expectCountsByFunction.set(currentFunction, currentCount)

          if (currentCount > max) {
            context.report({
              node,
              messageId: 'maxExpect',
              data: {
                count: currentCount,
                max,
              },
            })
          }
        }
      },
    }
  },
})
