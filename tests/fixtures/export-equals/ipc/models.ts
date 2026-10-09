// biome-ignore-all lint/style/noNamespace: the fixture needs a namespace to alias into
namespace Models {
   export interface Account {
      owner: string;
   }
}

// A namespace as the whole module.
export = Models;
