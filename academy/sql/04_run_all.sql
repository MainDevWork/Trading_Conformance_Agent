-- Builds the three layers in order by running their stored procedures. Set @folder in the first EXEC to the folder
-- holding the three month folders of the anonymised Excel files, ending with a backslash.

USE TradingConformance;
GO

EXEC bronze.build_bronze @folder = N'C:\TradingData\bronze\';
EXEC silver.build_silver;
EXEC gold.build_gold;
