import {
  GraphQLObjectType,
  GraphQLResolveInfo,
  getNullableType,
  isListType,
} from 'graphql';
import type { Connection } from 'graphql-relay';
import { connectionFromArray } from 'graphql-relay/connection/arrayConnection';

import {
  getConnectionNodeType,
  isConnectionType,
  resolveLocalOrGlobalId,
} from './relay';
import type { MockFieldResolver, MockGraphQLFieldResolver } from './store';
import { Item, getNullableNamedType, isRef, valueOrRefId } from './utils';

export interface RelatedOptions {
  idFieldName?: string;
  relatedFieldName: string;
  filter?: (item: Item, args: any) => boolean;
}

/**
 * Create a filter function that can be used to implement a mock item
 * filter from a set of field resolver `args`.
 *
 * @param filters An object map of arg names to a filter function
 * @returns true if the item matches any of the arg filters
 */
export function filterByArgs<TArgs>(
  filters: { [K in keyof TArgs]?: (item: Item, args: TArgs) => boolean },
) {
  return (item: any, args: TArgs) => {
    return (Object.keys(filters) as Array<keyof TArgs>).reduce<boolean>(
      (filtered, argKey) =>
        filtered && (args[argKey] ? !!filters[argKey]?.(item, args) : true),
      true,
    );
  };
}

export function itemByArg(
  argName: string,
  mapArg = (arg: any) => arg,
): MockFieldResolver {
  return function resolveByArg({ [argName]: arg }, { mocks }, { returnType }) {
    return (
      mocks.find(
        getNullableNamedType(returnType).name,
        (item) => item[argName] === mapArg(arg),
      ) ?? null
    );
  };
}

export function itemById(argName = 'id'): MockGraphQLFieldResolver {
  return function resolveById(
    _src,
    { [argName]: id },
    { mocks },
    { returnType },
  ) {
    const localId = resolveLocalOrGlobalId(id);
    return mocks.get(getNullableNamedType(returnType).name, localId) ?? null;
  };
}

function assertId(
  id: any,
  methodName: string,
  field: string,
  src: any,
  info: GraphQLResolveInfo,
): asserts id is string {
  if (!id) {
    throw new Error(
      `${methodName} is missing an id (field: "${field}").

    source: ${JSON.stringify(src)}
    field: "${info.fieldName}"
    parentType: ${getNullableNamedType(info.parentType)}
    returnType: ${getNullableNamedType(info.returnType)}`,
    );
  }
}

/**
 * A factory method that returns a resolver for simple foreign key relationships in the graph.
 * Provide the `idFieldName` of a mock object and it will resolve a mock object for the return type
 * of the current field. `related` will also resolve lists of items in the case of a `GraphQLList` field.
 *
 * > Heads up! You don't need to explicitly configure unambiguous relationships, like the example below.
 * > The mocks will automatically try and resolve types based on inferred foreign keys for each mock type.
 *
 * ```ts
 * import { related } from '@4c/graphql-mocking';
 *
 * mocks.add('Organization', {
 *   $id: 'o1',
 *   name: 'Northwinds'
 * })
 * mocks.addMany('Orders', [
 *   { $id: 'or1', $customerId: 'c1', },
 *   { $id: 'or2', $customerId: 'c1', }
 * ])
 *
 * mocks.add('Customer', {
 *   $id: 'c1',
 *   name: 'Betsy Smith',
 *   organizationId: 'o1'
 * })
 *
 * mocks.mock('Customer', (obj) => ({
 *   orders: related({
 *     idFieldName: '$id',
 *     relatedFieldName: '$customerId'
 *   })
 *   organization: related({
 *     idFieldName: 'organizationId',
 *     relatedFieldName: '$id'
 *   })
 * }))
 *
 * //...
 *
 * const result = await graphql(mocks.mockedSchema, `
 *   query {
 *     allCustomers {
 *       name
 *       organization {
 *         name
 *       }
 *     }
 *   }
 * `)
 * ```
 *
 * @param options
 * @param options.idFieldName The mock-local field that contains the FK value
 * @param options.relatedFieldName The foreign key field on our list of items. This field must exist
 * on mock objects for the field return type.
 * @returns A `MockGraphQLFieldResolver` that resolves to a related item or list of related items depending on the graphQL field type.
 */
export function related({
  idFieldName,
  relatedFieldName,
  filter,
}: RelatedOptions): MockGraphQLFieldResolver {
  if (relatedFieldName == null)
    throw new Error(
      `related() relatedFieldName cannot be empty, please provide a field `,
    );

  return function relatedItemResolver(src, args, { mocks }, info) {
    const mock = isRef(src) ? mocks.get(src) : src;

    const id = idFieldName ? mock[idFieldName] : mocks.getId(mock);

    assertId(
      id,
      'related()',
      idFieldName || `${mocks.idField} or $id`,
      mock,
      info,
    );

    const otherType = getNullableNamedType(info.returnType);

    const find = (value: any, fk: string) => {
      return Array.isArray(value)
        ? value.find((v) => valueOrRefId(v) === fk)
        : valueOrRefId(value) === fk;
    };

    return isListType(getNullableType(info.returnType))
      ? mocks
          .getAll(otherType.name)
          .filter(
            (i: any) =>
              find(i[relatedFieldName], id) && (!filter || filter(i, args)),
          )
      : mocks.find(
          otherType.name,
          (i: any) =>
            find(i[relatedFieldName], id) && (!filter || filter(i, args)),
        );
  };
}

export interface ConnectionOptions extends RelatedOptions {
  nodeType?: string;
}

export function generateConnectionFromArray(
  nodes: any[],
  args: any,
  connectionType: GraphQLObjectType,
) {
  const conn = connectionFromArray(nodes, args) as Connection<Item> & {
    nodes?: Item[];
    totalCount?: number;
  };
  const fields = connectionType.getFields();

  if (fields.nodes) {
    conn.nodes = conn.edges.map((e) => e.node);
  }
  if (fields.totalCount) {
    conn.totalCount = nodes.length;
  }
  if (!fields.edges) {
    delete (conn as any).edges;
  }

  return conn;
}

/**
 * Resolve a connection type to it's related items. Similar to `related` for a list
 * of items, but handles pagination according to the connection arguments, using `connectionFromArray`
 * from `graphql-relay`.
 * ```ts
 * import { connection } from '@4c/graphql-mocking';
 *
 * mocks.addMany('Orders', [
 *   { $id: 'or1', $customerId: 'c1', },
 *   { $id: 'or2', $customerId: 'c1', },
 *   { $id: 'or3', $customerId: 'c2', },
 * ])
 *
 * mocks.add('Customer', {
 *   $id: 'c1',
 *   name: 'Betsy Smith',
 * })
 *
 * mocks.mock('Customer', (obj) => ({
 *   orderConnection: connection({
 *     idFieldName:'$id',
 *     relatedFieldName: '$customerId'
 *   })
 * }))
 *
 * //...
 *
 * const result = await graphql(mocks.mockedSchema, `
 *   query {
 *     allCustomers {
 *       name
 *       orderConnection {
 *         edges {
 *           node { name }
 *         }
 *       }
 *     }
 *   }
 * `)
 * ```
 *
 * @param options The same set of options as `related` with the addition of `nodeType` for
 * cases where the type cannot be inferred correctly.
 * @returns A `MockFieldResolver` that resolves connection of related items
 */
export function connection({
  idFieldName,
  relatedFieldName,
  nodeType,
  filter,
}: ConnectionOptions): MockGraphQLFieldResolver {
  if (relatedFieldName == null)
    throw new Error(
      `connection() relatedFieldName cannot be empty, please provide a field `,
    );

  return function connectionResolver(src, args, { mocks }, info) {
    const { parentType, returnType } = info;
    const mock = isRef(src) ? mocks.get(src) : src;
    const id = idFieldName ? mock[idFieldName] : mocks.getId(mock);

    assertId(
      id,
      'connection()',
      idFieldName || `${mocks.idField} or $id`,
      mock,
      info,
    );
    if (!id) {
      throw new Error(
        `connection() is missing an id (field: ${
          idFieldName || mocks.idField
        }) on source object: ${JSON.stringify(mock)}`,
      );
    }

    const connType = getNullableNamedType(returnType);
    if (!isConnectionType(connType)) {
      throw new Error(
        `Invalid connection type: ${connType.name} on parent type: ${
          getNullableNamedType(parentType).name
        }`,
      );
    }

    nodeType = nodeType || getConnectionNodeType(connType).name;

    let nodes = mocks
      .getAll(nodeType)
      .filter((i: any) => valueOrRefId(i[relatedFieldName]) === id);

    if (filter) nodes = nodes.filter(filter);

    return generateConnectionFromArray(nodes, args, connType);
  };
}

export const name: MockFieldResolver = (_, _ctx, info) =>
  info.faker.name.findName();
