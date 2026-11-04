SELECT 42, 3.14, .5 FROM t;
--     ^ number
--         ^ float
--               ^ float
SELECT 1., 1e5, 1.5E-3, 0x1F FROM t;
--     ^ float
--         ^ float
--              ^ float
--                      ^ number
