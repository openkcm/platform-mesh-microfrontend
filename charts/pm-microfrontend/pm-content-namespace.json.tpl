{
  "name": "platform-mesh-microfrontend-namespace",
  "luigiConfigFragment": {
    "data": {
      "nodes": [
        {
          "pathSegment": "openkcm",
          "navigationContext": "openkcm-namespace",
          "label": "Encryption Keys",
          "entityType": "main.core_platform-mesh_io_account.namespace",
          "category": {
            "icon": "shield",
            "label": "OpenKCM",
            "collapsible": true,
            "order": __NAMESPACE_CATEGORY_ORDER__
          },
          "keepSelectedForChildren": true,
          "loadingIndicator": { "enabled": false },
          "context": {
            "openkcmLevel": "namespace",
            "accountNamespace": "__ACCOUNT_NAMESPACE__"
          },
          "url": "__HOST__/index.html"
        }
      ]
    }
  }
}
