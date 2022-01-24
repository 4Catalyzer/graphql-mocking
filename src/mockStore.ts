import { GraphQLSchema } from 'graphql';

import type { MockTypeMap } from './store';

export default class MockStore {
  private store = new Map<string, Record<string, any>>();

  constructor(private schema: GraphQLSchema, private mocks: MockTypeMap) {}

  private get(args: any) {
    const { typeName, key, fieldName, fieldArgs, defaultValue } = args;

    if (!fieldName) {
      let valuesToInsert = defaultValue || {};

      if (key) {
        valuesToInsert = { ...valuesToInsert, ...makeRef(typeName, key) };
      }

      return this.insert(typeName, valuesToInsert, true);
    }

    const fieldNameInStore: string = getFieldNameInStore(fieldName, fieldArgs);

    if (
      this.store[typeName] === undefined ||
      this.store[typeName][key] === undefined ||
      this.store[typeName][key][fieldNameInStore] === undefined
    ) {
      let value;
      if (defaultValue !== undefined) {
        value = defaultValue;
      } else if (this.isKeyField(typeName, fieldName)) {
        value = key;
      } else {
        value = this.generateFieldValue(
          typeName,
          fieldName,
          (otherFieldName, otherValue) => {
            // if we get a key field in the mix we don't care
            if (this.isKeyField(typeName, otherFieldName)) return;

            this.set({
              typeName,
              key,
              fieldName: otherFieldName,
              value: otherValue,
              noOverride: true,
            });
          },
        );
      }

      this.set({
        typeName,
        key,
        fieldName,
        fieldArgs,
        value,
        noOverride: true,
      });
    }

    return this.store[typeName][key][fieldNameInStore];
  }
}
