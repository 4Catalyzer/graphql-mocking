import {
  GraphQLFieldResolver,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLResolveInfo,
  GraphQLSchema,
  GraphQLType,
  defaultFieldResolver,
  getNullableType,
  isAbstractType,
  isEnumType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
} from 'graphql';
import { getNullableNamedType, isRootType, mergeMocks } from './utils';
import { globalIdMock, hasNodeInterface, nodeMock } from './relay';

import { addMocksToSchema } from './mockSchema';
import upperFirst from 'lodash/upperFirst';

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

export type MockFieldResolver<
  TContext = any,
  TArgs = { [argName: string]: any },
> = (
  args: TArgs,
  context: TContext & { mocks: Mocks },
  info: GraphQLResolveInfo,
) => Record<string, MockFieldResolver | ResolvedValue> | ResolvedValue;

export type MockGraphQLFieldResolver<
  TSource = any,
  TContext = any,
  TArgs = { [argName: string]: any },
> = (
  source: TSource,
  args: TArgs,
  context: TContext & { mocks: Mocks },
  info: GraphQLResolveInfo,
) => Record<string, MockFieldResolver | ResolvedValue> | ResolvedValue;

interface Ref {
  $$ref: { type: string; id: string };
}

interface Item {
  [fields: string]: unknown | Ref;
}

const takeRandom = <T>(arr: readonly T[]) =>
  arr[Math.floor(Math.random() * arr.length)];

type ResolverArgs = [
  source: any,
  args: any,
  context: any,
  info: GraphQLResolveInfo,
];

const valueOrRefId = (v: any) => (isRef(v) ? v.$$ref.id : v);

export function isRef(v: any): v is Ref {
  return typeof v === 'object' && v && '$$ref' in v;
}

export function isRefableType(v: GraphQLType) {
  if (isNonNullType(v)) v = v.ofType;
  return isObjectType(v) || isInterfaceType(v) || isListType(v);
}

export function relatedItem({
  id,
  relatedFieldName,
}: {
  id: any;
  relatedFieldName: string;
}): MockFieldResolver {
  return (_args, { mocks }, info) => {
    const otherType = getNullableNamedType(info.returnType);
    return mocks.find(
      otherType.name,
      (i: any) => valueOrRefId(i[relatedFieldName]) === id,
    );
  };
}

export function relatedItems({
  id,
  relatedFieldName,
}: {
  id: any;
  relatedFieldName: string;
}): MockFieldResolver {
  return (_args, { mocks }, info) => {
    const otherType = getNullableNamedType(info.returnType);
    return mocks
      .getAll(otherType.name)
      .filter((i: any) => valueOrRefId(i[relatedFieldName]) === id);
  };
}

interface TypeSpec {
  fks: Record<string, string>;
}

class Mocks {
  idField: string;

  constructor(
    private schema: GraphQLSchema,
    { idField }: { idField?: string } = {},
  ) {
    this.idField = idField ?? 'id';

    this.mocks = {
      Int: () => Math.round(Math.random() * 200) - 100,
      Float: () => Math.random() * 200 - 100,
      String: () => 'Hello World',
      Boolean: () => Math.random() > 0.5,
      ID: globalIdMock,
    };

    if (hasNodeInterface(schema)) {
      this.mock('Node', nodeMock);
    }
  }

  private ids = new Map<string, number>();

  private mocks: MockTypeMap;

  private items = new Map<string, Item>();
  private store = new Map<string, Map<string, Item>>();

  private typeSpecs = new Map<string, TypeSpec>();

  private getId(obj: any) {
    return obj[this.idField] || obj.$id;
  }

  private isAbstractField(fieldName: string): fieldName is `$${string}` {
    return fieldName.startsWith('$');
  }

  private getFkFromField(fieldName: string) {
    const name = fieldName.slice(1).replace(/Id$/, '');
    const typeName = upperFirst(name);
    try {
      this.getObjectType(typeName);
      return typeName;
    } catch {
      throw new Error(
        `related id field "${fieldName}" -> "${typeName}" does not coorespond to a schema type`,
      );
    }
  }

  private getType(typeName: string) {
    const type = this.schema.getType(typeName);

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
    if (isRef(id)) id = id.$$ref.id;
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

  addMany(typeName: string, items: Record<string, unknown | Ref>[]) {
    return items.map((item) => this.add(typeName, item));
  }

  add(typeName: string, item: Record<string, unknown | Ref>) {
    const type = this.getObjectType(typeName);

    let id = this.getId(item);
    const stored: Item = {};
    if (!id) {
      id = this.id(typeName);
      stored.$id = id;
    }

    let typeSpec = this.typeSpecs.get(typeName) || { fks: {} };

    for (const [key, value] of Object.entries(item)) {
      if (this.isAbstractField(key)) {
        stored[key] = value;

        if (key !== '$id') {
          const fk = this.getFkFromField(key);
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
      const fieldType = this.getType(field.type as any);

      if (isObjectType(fieldType) && typeof value === 'string') {
        typeSpec.fks[fieldType.name] = key;
        stored[key] = this.ref(fieldType.name, value);
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

  mockFromType(fieldType: GraphQLOutputType, args: ResolverArgs): unknown {
    const parentType = getNullableNamedType(args[3].parentType);
    const nullableType = getNullableType(fieldType);

    if (isListType(nullableType)) {
      const listType = getNullableNamedType(nullableType.ofType);
      const fk = this.getRelatedKey(listType.name, parentType.name);
      if (fk) {
        const [src, ...rest] = args;
        const id = this.getId(src);
        return relatedItems({ id, relatedFieldName: fk })(...rest);
      }

      return Array.from({ length: 2 }, () =>
        this.mockFromType(nullableType.ofType, args),
      );
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
        );
      }

      return {
        // eslint-disable-next-line @typescript-eslint/naming-convention
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
      return takeRandom(values);
    }
    if (isObjectType(nullableType)) {
      return {};
    }

    throw new Error(`${nullableType} not implemented`);
  }

  resolve(
    source: any,
    args: any,
    context: any = {},
    info: GraphQLResolveInfo,
  ): any {
    context.mocks ||= this;

    if (isRef(source)) {
      source = this.get(source);
    }

    const fieldType = getNullableType(info.returnType);
    const namedFieldType = getNullableNamedType(info.returnType);

    let defaultResolvedValue = defaultFieldResolver(
      source,
      args,
      context,
      info,
    );

    if (isRef(defaultResolvedValue)) {
      defaultResolvedValue = this.get(defaultResolvedValue);
    }

    // priority to default resolved value
    if (defaultResolvedValue !== undefined) {
      const mock = this.mocks[namedFieldType.name];

      return mock
        ? mergeMocks(
            mock.bind(null, source, args, context, info),
            defaultResolvedValue,
          )
        : defaultResolvedValue;
    }

    // root fields don't have a resolver we can intercept.
    // in order to mock those fields we run the root mocks here
    // in the child fields and update property
    if (isRootType(info.parentType, this.schema)) {
      const rootMock = this.mocks[info.parentType.name] as any;

      if (rootMock) {
        const result = rootMock(source, args, context, info)[info.fieldName];

        if (typeof result === 'function') {
          return this.resolve(
            { ...source, [info.fieldName]: result },
            args,
            context,
            info,
          );
        }
      }
    }

    return this.mockFromType(fieldType, [source, args, context, info]);
  }
}

export default Mocks;
