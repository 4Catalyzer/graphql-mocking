/* eslint-disable @typescript-eslint/ban-types */

import {
  GraphQLInterfaceType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLResolveInfo,
  GraphQLSchema,
  getNamedType,
  getNullableType,
  isAbstractType,
  isCompositeType,
  isEnumType,
  isInterfaceType,
  isListType,
  isObjectType,
  isScalarType,
  isUnionType,
} from 'graphql';
import { connectionFromArray } from 'graphql-relay';
import upperFirst from 'lodash/upperFirst';

import { addMocksToSchema } from './mockSchema';
import * as BaseMocks from './mocks';
import {
  getConnectionNodeType,
  getIdInfo,
  globalIdMock,
  hasNodeInterface,
  isConnectionType,
} from './relay';
import { connection, related } from './resolvers';
import {
  Faker,
  Item,
  Ref,
  getNullableNamedType,
  isRef,
  isRootType,
  seedFaker,
} from './utils';

export type MockFn = (generator: Faker) => any | undefined;
export type MockTypeMap = Record<string, MockFn>;

export type AnyObject = Record<PropertyKey, any>;

export type ResolvedValue =
  | string
  | number
  | boolean
  | any[]
  | AnyObject
  | null
  | undefined;

export type MockField = Record<string, MockFieldResolver | ResolvedValue>;

export type MockFieldResolverContext = MockField;

export interface MockGraphQLResolveInfo extends GraphQLResolveInfo {
  faker: Faker;
}

export type MockFieldResolver<
  TContext = {},
  TArgs = { [argName: string]: any },
> = (
  this: MockFieldResolverContext,
  args: TArgs,
  context: TContext & { mocks: Mocks },
  info: MockGraphQLResolveInfo,
) => MockField | ResolvedValue;

export type MockGraphQLFieldResolver<
  TSource = any,
  TContext = {},
  TArgs = { [argName: string]: any },
> = (
  source: TSource,
  args: TArgs,
  context: TContext & { mocks: Mocks },
  info: MockGraphQLResolveInfo,
) => MockField | ResolvedValue;

export { isRef, connection, related };

const removeRandom = <T>(arr: T[], faker: Faker) => {
  const idx = Math.floor(
    faker.datatype.number({ max: arr.length - 1, min: 0 }),
  );
  return arr.splice(idx, 1)[0];
};

const takeRandom = <T>(arr: readonly T[], faker: Faker) => {
  const idx = Math.floor(
    faker.datatype.number({ max: arr.length - 1, min: 0 }),
  );
  return arr[idx];
};

interface TypeSpec {
  fks: Record<string, string>;
}

class Mocks {
  idField: string;

  readonly schema: GraphQLSchema;

  readonly listLength: number;

  readonly mocked = new Set<string>();

  constructor(
    schemaOrSdl: GraphQLSchema | string,
    { idField }: { idField?: string } = {},
  ) {
    this.schema =
      typeof schemaOrSdl === 'string'
        ? // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
          require('@graphql-tools/schema').makeExecutableSchema({
            typeDefs: schemaOrSdl,
          })
        : schemaOrSdl;

    this.idField = idField ?? 'id';
    this.listLength = 2;

    this.mocks = {
      Int: BaseMocks.int,
      Float: BaseMocks.float,
      String: BaseMocks.string,
      Boolean: BaseMocks.bool,
      ID: globalIdMock,
    };

    // if (hasNodeInterface(this.schema)) {
    //   this.mock('Node', nodeMock);
    // }
  }

  private ids = new Map<string, number>();

  private mocks: MockTypeMap;

  private items = new Map<string, Item>();

  private fakerCache = new Map<string, Faker>();

  private store = new Map<string, Map<string, Item>>();

  private typeSpecs = new Map<string, TypeSpec>();

  getId(obj: any) {
    return obj[this.idField] || obj.$id;
  }

  private isAbstractField(fieldName: string): fieldName is `$${string}` {
    return fieldName.startsWith('$');
  }

  private getFkFromField(fieldName: string) {
    const match = fieldName.match(/\$(\w+)Id$/);

    if (!match) return null;

    const typeName = upperFirst(match[1]);

    try {
      this.getObjectType(typeName);
      return typeName;
    } catch {
      throw new Error(
        `related id field "${fieldName}" -> "${typeName}" does not correspond to a schema type`,
      );
    }
  }

  private getType(typeName: string | GraphQLNamedType) {
    const type = this.schema.getType(
      typeof typeName === 'string' ? typeName : typeName.name,
    );

    if (!type) {
      throw new Error(`${typeName} does not exist on schema`);
    }

    return type;
  }

  private getObjectType(typeName: string) {
    const type = this.getType(typeName);

    if (!(isObjectType(type) || isInterfaceType(type))) {
      throw new Error(`${typeName} is not an object or interface`);
    }

    return type;
  }

  private getField(
    type: GraphQLObjectType<any, any> | GraphQLInterfaceType,
    fieldName: string,
  ) {
    const field = type.getFields()[fieldName];
    if (!field) {
      throw new Error(`${fieldName} does not exist on type ${type.name}`);
    }
    return field;
  }

  get mockedSchema() {
    return addMocksToSchema({ schema: this.schema, store: this });
  }

  id(typeName: string) {
    this.getObjectType(typeName);
    const i = (this.ids.get(typeName) || 0) + 1;
    this.ids.set(typeName, i);
    return `${typeName}:${i}`;
  }

  get(ref: Ref, fieldName?: string): Item | null;

  get(typeName: string, id: string, fieldName?: string): Item | null;

  get(typeOrRef: string | Ref, id?: string, fieldName?: string) {
    const globalId = id && getIdInfo(id);
    if (globalId) {
      typeOrRef = globalId.type;
      id = globalId.id;
    }
    let typeName: string;

    if (isRef(typeOrRef)) {
      typeName = typeOrRef.$$ref.type;
      id = typeOrRef.$$ref.id;
      fieldName = id;
    } else {
      typeName = typeOrRef;
    }

    return this.generateTypeFromMocks(typeName, id, fieldName);
  }

  set(opts: any) {
    const existing = this.store.get(opts.typeName)?.get(opts.id);
    const value: Item = opts.fieldName
      ? { [opts.fieldName]: opts.value }
      : opts.value;

    if (existing) {
      for (const [field, fieldValue] of Object.entries(value)) {
        if (opts.override === false && existing[field] !== undefined) {
          continue;
        }
        existing[field] = fieldValue;
      }
    } else {
      value.$id = opts.id;
      this.addExample(opts.typeName, value);
    }
  }

  getAll(typeName: string) {
    this.getObjectType(typeName);
    return Array.from(this.store.get(typeName)?.values() || []);
  }

  find(typeName: string, cb: (item: Item) => boolean) {
    return this.getAll(typeName).find(cb) ?? null;
  }

  getFaker(typeName: string) {
    return seedFaker(typeName, this.fakerCache);
  }

  protected stubIfNeeded(typeName: string, id: string) {
    const ref = this.ref(typeName, id);

    if (!this.get(typeName, id)) {
      this.addExample(typeName, { $id: id });
    }
    return ref;
  }

  protected sample(typeName: string, faker: Faker) {
    const results = this.getAll(typeName);
    return results.length ? faker.random.arrayElement(results) : undefined;
  }

  define(
    typeName: string,
    spec: {
      resolver?: MockFieldResolver;
      generators?: MockFn;
      examples: Record<string, unknown | Ref>[];
    },
  ) {
    if (spec.generators) {
      this.mock(typeName, spec.generators);
    }

    return this.addExamples(typeName, spec.examples);
  }

  private mock(typeName: string, mocks: MockFn) {
    const faker = this.getFaker(typeName);
    this.mocks[typeName] = () => mocks(faker);

    return this;
  }

  addExamples(typeName: string, items: Record<string, unknown | Ref>[]) {
    return items.map((item) => this.addExample(typeName, item));
  }

  addExample(typeName: string, item: Record<string, unknown | Ref>) {
    const _type = this.getType(typeName);

    const type = this.getObjectType(
      isUnionType(_type) ? (item.__typename as string) : typeName,
    );

    let id = this.getId(item);
    const stored: Item = {};
    if (!id) {
      id = this.id(typeName);
      stored.$id = id;
    }

    const typeSpec = this.typeSpecs.get(typeName) || { fks: {} };
    const fields = type.getFields();
    const providedKeys = new Set();

    for (const [key, value] of Object.entries(item)) {
      if (this.isAbstractField(key)) {
        stored[key] = value;

        const fk = this.getFkFromField(key);
        if (fk) {
          typeSpec.fks[fk] = key;
        }

        continue;
      }

      const field = fields[key];

      if (!field) {
        throw new Error(`${key} does not exist on type ${type.name}`);
      } else {
        providedKeys.add(key);
      }

      const fieldType = this.getType(getNamedType(field.type));
      const isArrayOfStrings =
        Array.isArray(value) && typeof value[0] === 'string';

      if (isObjectType(fieldType) && typeof value === 'string') {
        typeSpec.fks[fieldType.name] = key;
        stored[key] = this.stubIfNeeded(fieldType.name, value);
      } else if (
        isListType(field.type) &&
        isCompositeType(field.type.ofType) &&
        isArrayOfStrings
      ) {
        typeSpec.fks[fieldType.name] = key;
        stored[key] = (value as string[]).map((v) =>
          this.stubIfNeeded(fieldType.name, v),
        );
      } else {
        stored[key] = value;
      }
      // }
    }

    this.typeSpecs.set(typeName, typeSpec);
    this.items.set(id, stored);

    let typeData = this.store.get(typeName);
    if (!typeData) {
      this.store.set(typeName, (typeData = new Map()));
    }
    typeData.set(id, stored);

    // return this.mockStore.insert(typeName, { ...stored, _id: id }, true);
  }

  getRelatedKey(typeNameA: string, typeNameB: string) {
    const typeSpec = this.typeSpecs.get(typeNameA);
    if (!typeSpec) return false;
    return typeSpec.fks[typeNameB];
  }

  ref(typeName: string, id: string): Ref {
    return { $$ref: { type: typeName, id } };
  }

  generateTypeFromMocks(
    typeName: string,
    id: string = this.id(typeName),
    fieldName?: string,
  ) {
    const key = `${typeName}:${id}`;
    const existing = this.store.get(typeName)?.get(id);

    const type = this.getObjectType(typeName);

    if (existing && this.mocked.has(key)) {
      if (fieldName) {
        if (existing[fieldName] === undefined) {
          existing[fieldName] = this.generateValueFromType(
            type.getFields()[fieldName].type,
            type,
          );
        }
        return existing[fieldName];
      }

      return existing;
    }

    const mock = this.mocks[typeName];
    const faker = this.getFaker(typeName);

    let mockValue;
    if (mock) {
      if (typeof mock === 'function') {
        mockValue = mock(faker);
      } else {
        mockValue = mock;
      }
    }

    const result: Record<string, any> = {};

    if (mockValue) {
      for (const field of Object.keys(mockValue)) {
        if (!this.isAbstractField(field) && !this.isField(typeName, field)) {
          throw new TypeError(
            `Generator for type "${typeName}" has an invalid field: "${field}" configured. Generators can only be valid fields of the GraphQL type`,
          );
        }

        const fieldMock =
          typeof mockValue[field] === 'function'
            ? mockValue[field]()
            : mockValue[field];

        if (fieldMock !== undefined) {
          result[field] = fieldMock;
        }
      }
    }

    if (fieldName && result[fieldName] === undefined) {
      result[fieldName] = this.generateValueFromType(
        type.getFields()[fieldName].type,
        type,
      );
    }

    if (existing) {
      this.set({ typeName, id, value: result, override: false });
    } else {
      this.addExample(
        typeName,
        this.getId(result) ? result : { $id: id, ...result },
      );
    }

    this.mocked.add(key);

    return fieldName ? result[fieldName] : this.get(typeName, id)!;
  }

  generateValueFromType(
    fieldType: GraphQLOutputType,
    parentType?: GraphQLNamedType,
    sample = true,
  ): unknown {
    const nullableType = getNullableType(fieldType);
    const faker = seedFaker(getNamedType(fieldType).name, this.fakerCache);

    const generateList = (type: GraphQLOutputType) => {
      const list = new Array(this.listLength);
      const results = isCompositeType(type) ? this.getAll(type.name) : [];

      for (let idx = 0; idx < list.length; idx++) {
        list[idx] = results.length
          ? removeRandom(results, faker)
          : this.generateValueFromType(type, getNamedType(fieldType), false);
      }

      return list;
    };

    if (isListType(nullableType)) {
      return generateList(nullableType.ofType);
    }

    if (isConnectionType(nullableType)) {
      const nodeType = getConnectionNodeType(nullableType);

      return connectionFromArray(generateList(nodeType), { first: 100 });
    }

    const mockFn = this.mocks[nullableType.name];

    const resolveMock = () => {
      const result = mockFn!(faker);

      return isRef(result) ? this.get(result) : result;
    };

    if (isScalarType(nullableType)) {
      if (!mockFn)
        throw new Error(`No mock defined for type "${nullableType.name}"`);

      return resolveMock();
    }
    if (isAbstractType(nullableType)) {
      let implementationType;
      let interfaceMockObj: any = {};

      if (mockFn) {
        interfaceMockObj = resolveMock();

        if (!interfaceMockObj?.__typename) {
          return Error(
            `Mock generated for abstract type "${nullableType.name}" did not return a "__typename" field. ` +
              'In order to resolve to a concrete type a `__typename` hint is required.',
          );
        }

        implementationType = this.getObjectType(interfaceMockObj.__typename);
      } else {
        implementationType = takeRandom(
          this.schema.getPossibleTypes(nullableType),
          faker,
        );
      }

      return {
        __typename: implementationType.name,
        ...interfaceMockObj,
        ...(this.generateValueFromType(implementationType, parentType) as any),
      };
    }

    if (mockFn) {
      return resolveMock();
    }

    if (isEnumType(nullableType)) {
      const values = nullableType.getValues().map((v) => v.value);
      return takeRandom(values, faker);
    }

    if (isObjectType(nullableType)) {
      if (!sample)
        return this.stubIfNeeded(
          nullableType.name,
          this.id(nullableType.name),
        );

      const results = this.getAll(nullableType.name);
      return takeRandom(results, faker) || {};
    }

    throw new Error(`${nullableType} not implemented`);
  }

  private generateFieldValueFromMocks(
    typeName: string,
    fieldName: string,
    onOtherFieldsGenerated?: (fieldName: string, value: unknown) => void,
  ): unknown | undefined {
    let value;

    const mock = this.mocks[typeName];

    if (mock) {
      const values = mock(this.getFaker(typeName));

      if (typeof values !== 'object' || values == null) {
        throw new Error(
          `Value returned by the mock for ${typeName} is not an object`,
        );
      }

      for (let [otherFieldKey, otherFieldValue] of Object.entries(values)) {
        if (otherFieldKey === fieldName) continue;
        if (typeof otherFieldValue === 'function') {
          otherFieldValue = otherFieldValue();
        }

        onOtherFieldsGenerated?.(otherFieldKey, otherFieldValue);
      }

      value = values[fieldName];
      if (typeof value === 'function') value = value();
    }

    if (value !== undefined) return value;

    const type = this.getType(typeName);
    // GraphQL 14 Compatibility
    const interfaces = 'getInterfaces' in type ? type.getInterfaces() : [];

    if (interfaces.length > 0) {
      for (const interface_ of interfaces) {
        if (value) break;
        value = this.generateFieldValueFromMocks(
          interface_.name,
          fieldName,
          onOtherFieldsGenerated,
        );
      }
    }

    return value;
  }

  private isField(typeName: string, fieldName: string) {
    return fieldName in this.getObjectType(typeName).getFields();
  }
}

export default Mocks;
