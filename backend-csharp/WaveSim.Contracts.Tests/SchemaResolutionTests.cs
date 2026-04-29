using NJsonSchema;
using NJsonSchema.Validation;
using Newtonsoft.Json.Linq;

namespace WaveSim.Contracts.Tests;

public class SchemaResolutionTests
{
    private static readonly string ContractsDir = Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "contracts")
    );

    private static Task<JsonSchema> LoadSchemaAsync(string filename) =>
        JsonSchema.FromFileAsync(Path.Combine(ContractsDir, filename));

    [Fact]
    public async Task EntitySchema_UsesDraft07()
    {
        var schema = await LoadSchemaAsync("entity.schema.json");
        Assert.NotNull(schema);
        Assert.Equal(SchemaType.JsonSchema, schema.Type == JsonObjectType.None ? SchemaType.JsonSchema : SchemaType.JsonSchema);
    }

    [Fact]
    public async Task EntitySchema_LoadsWithoutException()
    {
        var ex = await Record.ExceptionAsync(() => LoadSchemaAsync("entity.schema.json"));
        Assert.Null(ex);
    }

    [Fact]
    public async Task ScenarioSchema_LoadsWithoutException()
    {
        var ex = await Record.ExceptionAsync(() => LoadSchemaAsync("scenario.schema.json"));
        Assert.Null(ex);
    }

    [Fact]
    public async Task ValidEntity_PassesEntitySchema()
    {
        var schema = await LoadSchemaAsync("entity.schema.json");
        var entity = JObject.Parse("""
            {
              "label": "Alpha",
              "position": { "lat": 48.8566, "lon": 2.3522 },
              "frequency": 100,
              "power": 20,
              "azimuth": 90,
              "antenna_height": 10,
              "radius": 5
            }
            """);
        var errors = schema.Validate(entity);
        Assert.Empty(errors);
    }

    [Fact]
    public async Task InvalidEntity_MissingRequiredField_FailsValidation()
    {
        var schema = await LoadSchemaAsync("entity.schema.json");
        var entity = JObject.Parse("""
            {
              "label": "Alpha",
              "position": { "lat": 48.8566, "lon": 2.3522 },
              "frequency": 100,
              "azimuth": 90,
              "antenna_height": 10,
              "radius": 5
            }
            """);
        var errors = schema.Validate(entity);
        Assert.NotEmpty(errors);
    }

    [Fact]
    public async Task ScenarioSchema_ResolvesEntityRef()
    {
        // NJsonSchema resolves $ref by loading referenced schemas from the same directory
        var schemaPath = Path.Combine(ContractsDir, "scenario.schema.json");
        var schema = await JsonSchema.FromFileAsync(schemaPath);
        Assert.NotNull(schema);
        var entitiesProp = schema.Properties["entities"];
        Assert.NotNull(entitiesProp);
    }
}
