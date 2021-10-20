/* eslint-disable @typescript-eslint/ban-types */
import {
  GraphQLInterfaceType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLResolveInfo,
  GraphQLSchema,
  defaultFieldResolver,
  getNamedType,
  getNullableType,
  isAbstractType,
  isEnumType,
  isInterfaceType,
  isListType,
  isObjectType,
  isScalarType,
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
  nodeMock,
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

export type MockTypeMap = Record<string, MockGraphQLFieldResolver | undefined>;

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

const getFaker = (
  info: GraphQLResolveInfo,
  obj: Item,
  mocks: any,
  cache: Map<string, Faker>,
) => {
  const namedType = getNullableNamedType(info.parentType);
  return seedFaker(
    `${namedType.name}.${info.fieldName}:${mocks.getId(obj) || obj.id || ''}`,
    cache,
  );
};

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

type ResolverArgs = [
  source: any,
  args: any,
  context: any,
  info: MockGraphQLResolveInfo,
];

interface TypeSpec {
  fks: Record<string, string>;
}

class Mocks {
  idField: string;

  private schema: GraphQLSchema;

  readonly listLength: number;

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

    if (hasNodeInterface(this.schema)) {
      this.mock('Node', nodeMock);
    }
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

  mock(mocks: MockTypeMap): this;

  mock(typeName: string, mocks: MockGraphQLFieldResolver): this;

  mock(
    mocksOrTypeName: string | MockTypeMap,
    maybeMocks?: MockGraphQLFieldResolver,
  ): this {
    if (typeof mocksOrTypeName === 'string') {
      this.getType(mocksOrTypeName);
      this.mocks[mocksOrTypeName] = maybeMocks!;
    } else {
      for (const [typeName, mock] of Object.entries(mocksOrTypeName)) {
        this.getType(typeName);
        this.mocks[typeName] = mock;
      }
    }

    return this;
  }

  get(ref: Ref): Item;

  get(typeName: string, id: string): Item;

  get(t: string | Ref, id?: string) {
    const globalId = id && getIdInfo(id);
    if (globalId) {
      t = globalId.type;
      id = globalId.id;
    }
    return isRef(t)
      ? this.store.get(t.$$ref.type)?.get(t.$$ref.id)
      : this.store.get(t)?.get(id!);
  }

  getAll(typeName: string) {
    this.getObjectType(typeName);
    return Array.from(this.store.get(typeName)?.values() || []);
  }

  find(typeName: string, cb: (item: Item) => boolean) {
    return this.getAll(typeName).find(cb);
  }

  protected sample(typeName: string, faker: Faker) {
    const results = this.getAll(typeName);
    return results.length ? faker.random.arrayElement(results) : undefined;
  }

  addExamples(typeName: string, items: Record<string, unknown | Ref>[]) {
    return items.map((item) => this.addExample(typeName, item));
  }

  addExample(typeName: string, item: Record<string, unknown | Ref>) {
    const type = this.getObjectType(typeName);

    let id = this.getId(item);
    const stored: Item = {};
    if (!id) {
      id = this.id(typeName);
      stored.$id = id;
    }

    const typeSpec = this.typeSpecs.get(typeName) || { fks: {} };

    for (const [key, value] of Object.entries(item)) {
      if (this.isAbstractField(key)) {
        stored[key] = value;

        const fk = this.getFkFromField(key);
        if (fk) {
          typeSpec.fks[fk] = key;
        }

        continue;
      }

      const field = this.getField(type, key);

      // if (isRef(value)) {
      //   if (!isRefableType(field.type)) {
      //     throw new Error(
      //       `field ${key} on type ${typeName} cannot be assigned to a Ref, only object of interfaces can be referenced`,
      //     );
      //   }
      //   stored[key] = value;
      // }
      // if (Array.isArray(value)) {
      //   if (isRef(value[0]) && !isRefableType(field.type)) {
      //     throw new Error(
      //       `field ${key} on type ${typeName} cannot be assigned to a Ref, only object of interfaces can be referenced`,
      //     );
      //   }

      //   stored[key] = [...value];
      // } else {
      // TODO nesting

      const fieldType = this.getType(getNamedType(field.type));
      const isArrayOfStrings =
        Array.isArray(value) && typeof value[0] === 'string';

      if (isObjectType(fieldType) && typeof value === 'string') {
        typeSpec.fks[fieldType.name] = key;
        stored[key] = this.ref(fieldType.name, value);
      } else if (isListType(field.type) && isArrayOfStrings) {
        typeSpec.fks[fieldType.name] = key;
        stored[key] = (value as string[]).map((v) =>
          this.ref(fieldType.name, v),
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

    return this.ref(typeName, id);
  }

  getRelatedKey(typeNameA: string, typeNameB: string) {
    const typeSpec = this.typeSpecs.get(typeNameA);
    if (!typeSpec) return false;
    return typeSpec.fks[typeNameB];
  }

  ref(typeName: string, id: string): Ref {
    return { $$ref: { type: typeName, id } };
  }

  mockFromType(
    fieldType: GraphQLOutputType,
    args: ResolverArgs,
    sample = true,
  ): unknown {
    const { faker } = args[3];
    const parentType = getNullableNamedType(args[3].parentType);
    const nullableType = getNullableType(fieldType);

    const generateList = (type: GraphQLOutputType) => {
      const list = new Array(this.listLength);
      const named = getNullableNamedType(type);
      const results = named ? this.getAll(named.name) : [];

      for (let idx = 0; idx < list.length; idx++) {
        list[idx] = results.length
          ? removeRandom(results, faker)
          : this.mockFromType(type, args, false);
      }

      return list;
    };

    if (isListType(nullableType)) {
      const listType = getNullableNamedType(nullableType.ofType);
      const fk = this.getRelatedKey(listType.name, parentType.name);
      if (fk) {
        const [source, ...rest] = args;
        return related({
          relatedFieldName: fk,
        }).apply(source, rest);
      }

      return generateList(nullableType.ofType);
    }

    if (isConnectionType(nullableType)) {
      const nodeType = getConnectionNodeType(nullableType);
      const fk = this.getRelatedKey(nodeType.name, parentType.name);

      if (fk) {
        const [source, ...rest] = args;
        return connection({
          relatedFieldName: fk,
        }).apply(source, rest);
      }

      return connectionFromArray(generateList(nodeType), args[1]);
    }

    const mockFn = this.mocks[nullableType.name];

    const resolveMock = () => {
      const result = mockFn!(...args);

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
        ...(this.mockFromType(implementationType, args) as any),
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
      const fk = this.getRelatedKey(nullableType.name, parentType.name);

      if (fk) {
        const [source, ...rest] = args;
        return related({
          relatedFieldName: fk,
        }).apply(source, rest);
      }

      if (!sample) return {};

      const results = this.getAll(nullableType.name);
      return takeRandom(results, faker) || {};
    }

    throw new Error(`${nullableType} not implemented`);
  }

  resolve(
    source: any,
    args: any,
    context: any = {},
    info: MockGraphQLResolveInfo,
  ): any {
    if (isRef(source)) {
      source = this.get(source);
    }

    context.mocks ||= this;
    info.faker = getFaker(info, source, this, this.fakerCache);

    const fieldType = getNullableType(info.returnType);

    let defaultResolvedValue = defaultFieldResolver(
      source,
      args,
      context,
      info,
    );

    if (isRef(defaultResolvedValue)) {
      defaultResolvedValue = this.get(defaultResolvedValue);
    }

    if (defaultResolvedValue !== undefined) {
      const namedType = getNullableNamedType(fieldType);

      // in the case of an object type, we want to merge in any additional mocks
      // TODO: we should store the results of this so it's consistent
      if (isObjectType(namedType)) {
        if (this.mocks[namedType.name]) {
          const mockFn = this.mocks[namedType.name]!;

          if (Array.isArray(defaultResolvedValue)) {
            return defaultResolvedValue.map((item: any) => ({
              ...(mockFn(item, args, context, info) as any),
              ...item,
            }));
          }

          return {
            ...(mockFn(source, args, context, info) as any),
            ...defaultResolvedValue,
          };
        }
      }
      return defaultResolvedValue;
    }

    // we want to avoid the rootType path if
    // we've already run through it to avoid an infinite loop
    const hasResolved = info.fieldName in source;

    // root fields don't have a resolver we can intercept.
    // in order to mock those fields we run the root mocks here
    // in the child fields and update property
    if (!hasResolved && isRootType(info.parentType, this.schema)) {
      const rootMock = this.mocks[info.parentType.name] as any;

      if (rootMock) {
        const result = rootMock(source, args, context, info)[info.fieldName];

        source = { ...source, [info.fieldName]: result };

        return this.resolve(source, args, context, info);
      }
    }

    const mock = this.mockFromType(fieldType, [
      source,
      args,
      context,
      info,
    ]) as MockField;

    return mock;
  }
}

export default Mocks;
